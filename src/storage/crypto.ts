/**
 * 人情账 · 加密
 *
 * 目标：给「应用锁」提供真正的本地加密，而不是把密码存起来对一下。
 *
 *  密码 ──Argon2id(salt)──▶ 256 位密钥 ──AES-GCM──▶ 密文
 *
 * 关键点：
 *  1. 密码本身永不落盘，只留在内存里。
 *  2. 每次保存都用新的随机 IV（GCM 绝不能重用 IV）。
 *  3. 盐和 IV 随密文一起存，它们不是秘密。
 *  4. 解密失败 = 密码错误或文件损坏，WebCrypto 会直接抛错。
 */

import { argon2id } from 'hash-wasm';

/** Argon2id 参数。内存 64MiB、3 轮，桌面端约 0.2–0.5 秒，够用又不烦人。 */
const ARGON2 = {
  iterations: 3,
  memoryKiB: 65536,
  parallelism: 1,
  hashLength: 32,
} as const;

const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface KdfParams {
  algo: 'argon2id';
  salt: string; // base64
  iterations: number;
  memoryKiB: number;
  parallelism: number;
}

export interface CipherBlob {
  /** base64 密文（含 GCM tag） */
  data: string;
  /** base64 IV */
  iv: string;
  kdf: KdfParams;
}

/* ------------------------------------------------------------------ 编码 */

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * WebCrypto 的 BufferSource 要求底层是 ArrayBuffer（不能是 SharedArrayBuffer）。
 * TS 5.7+ 的 Uint8Array 泛型会把两者都算进来，这里显式收窄一次。
 */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/* ------------------------------------------------------------------ 密钥派生 */

export function newSalt(): string {
  return toBase64(randomBytes(SALT_BYTES));
}

/**
 * 由密码派生密钥。同一个密码 + 同一个盐 → 同一个密钥。
 * 派生很慢是故意的：暴力破解的成本就来自这里。
 */
export async function deriveKey(password: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id({
    password,
    // hash-wasm 接受 Uint8Array；WebCrypto 那边才需要收窄成 ArrayBuffer
    salt: fromBase64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memoryKiB,
    hashLength: ARGON2.hashLength,
    outputType: 'binary',
  });

  // outputType: 'binary' 时运行时一定是 Uint8Array，但类型签名是联合类型
  const keyBytes = raw as unknown as Uint8Array;

  return crypto.subtle.importKey('raw', buf(keyBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function defaultKdf(): KdfParams {
  return {
    algo: 'argon2id',
    salt: newSalt(),
    iterations: ARGON2.iterations,
    memoryKiB: ARGON2.memoryKiB,
    parallelism: ARGON2.parallelism,
  };
}

/* ------------------------------------------------------------------ 加解密 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 加密任意 JSON 可序列化的值 */
export async function encryptJson(value: unknown, password: string): Promise<CipherBlob> {
  const kdf = defaultKdf();
  const key = await deriveKey(password, kdf);
  const iv = randomBytes(IV_BYTES);
  const plaintext = encoder.encode(JSON.stringify(value));

  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) },
    key,
    plaintext,
  );

  return {
    data: toBase64(new Uint8Array(cipher)),
    iv: toBase64(iv),
    kdf,
  };
}

/**
 * 解密。密码不对时抛 Error('密码不对')，
 * 便于界面区分「密码错」和「文件坏了」。
 */
export async function decryptJson<T>(blob: CipherBlob, password: string): Promise<T> {
  let key: CryptoKey;
  try {
    key = await deriveKey(password, blob.kdf);
  } catch {
    throw new Error('密码不对');
  }

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(fromBase64(blob.iv)) },
      key,
      buf(fromBase64(blob.data)),
    );
  } catch {
    // GCM 校验失败：密码错误，或数据被改过
    throw new Error('密码不对，或文件已损坏');
  }

  return JSON.parse(decoder.decode(plain)) as T;
}

/** 环境是否支持（老浏览器或非安全上下文下 WebCrypto 不可用） */
export function cryptoAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  );
}

/** 密码强度提示，只做温和提醒，不拦人 */
export function passwordHint(password: string): string | null {
  if (password.length < 6) return '密码太短了，建议至少 6 位。';
  if (/^\d+$/.test(password)) return '纯数字容易被猜到，建议加几个字母。';
  return null;
}
