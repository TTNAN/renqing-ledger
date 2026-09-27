/**
 * 人情账 · 设置
 *
 * 四件事：备份与恢复、应用锁、录入偏好、危险操作。
 * 加密这块要特别小心：设了密码之后，所有写入都是密文，
 * 密码只存在内存里，忘了密码就真的打不开了 —— 界面上必须说清楚。
 */

import { useEffect, useMemo, useState } from 'react';
import { formatCents } from '@/domain/money';
import { contactsToCSV, entriesToCSV } from '@/domain/export';
import { summarizeContacts } from '@/domain/stats';
import { useStore } from '@/store/useStore';
import type { Route } from '@/ui/router';
import { ConfirmModal, EmptyState, Field, Modal, Segmented } from '@/ui/components/common';
import {
  changePassword,
  downloadText,
  exportEnvelope,
  importEnvelope,
  listAllBackups,
  pickTextFile,
  removeBackup,
  restoreFromBackup,
  type BackupRecord,
} from '@/storage/repo';
import { cryptoAvailable, passwordHint } from '@/storage/crypto';
import { SEED_NOTICE } from '@/storage/seed';
import { estimateUsage } from '@/storage/db';
import { formatCN } from '@/domain/date';
import { LedgerNotReady } from '@/ui/components/LedgerNotReady';
import {
  appVersion,
  backupFileName,
  chooseBackupDir,
  deviceWord,
  getDataLocation,
  isAndroid,
  isDesktop,
  platform,
  revealDataFolder,
  tableFileName,
  type DataLocation,
} from '@/platform';

export function SettingsPage({ go }: { go: (r: Route) => void }) {
  const ledger = useStore((s) => s.ledger);
  const toast = useStore((s) => s.toast);
  const wipe = useStore((s) => s.wipe);
  const loadSeed = useStore((s) => s.loadSeed);
  const replaceLedger = useStore((s) => s.replaceLedger);
  const setHouseholdName = useStore((s) => s.setHouseholdName);
  const updateSettings = useStore((s) => s.updateSettings);
  const runAutoBackup = useStore((s) => s.runAutoBackup);
  const encrypted = useStore((s) => s.encrypted);
  const password = useStore((s) => s.password);

  const [household, setHousehold] = useState(ledger?.household.name ?? '我家');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [lockModal, setLockModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPasswordNeeded, setImportPasswordNeeded] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [location, setLocation] = useState<DataLocation | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const settings = ledger?.settings;

  useEffect(() => {
    void estimateUsage().then(setUsage);
  }, [ledger]);

  /* 数据在哪：桌面端会去问主进程要真实路径 */
  useEffect(() => {
    void getDataLocation().then(setLocation);
    void appVersion().then(setVersion);
  }, []);

  const backupSummary = useMemo(() => {
    if (!ledger) return null;
    const rows = summarizeContacts(ledger.entries, ledger.contacts);
    return {
      contacts: rows.length,
      entries: ledger.entries.filter((e) => !e.deleted_at).length,
      events: ledger.events.filter((e) => !e.deleted_at).length,
    };
  }, [ledger]);

  if (!ledger || !settings) return <LedgerNotReady go={go} />;

  /* ---------------- 导出全库 JSON ---------------- */
  async function exportJSON() {
    if (!ledger) return;
    try {
      const usePassword = encrypted && password ? password : undefined;
      const envelope = await exportEnvelope(ledger, usePassword);
      const text = JSON.stringify(envelope, null, 2);

      // 文件名按平台约定：renqing-backup-YYYYMMDD-HHmm.json
      const result = await downloadText(backupFileName(), text);

      if (result.canceled) return;
      if (!result.ok) {
        toast('导出失败：' + (result.error ?? '未知错误'), 'error');
        return;
      }
      toast(
        (result.where ?? '备份已导出') +
          (usePassword ? '（已加密，恢复时需要同一个密码）' : ''),
      );
    } catch (err) {
      toast('导出失败：' + (err instanceof Error ? err.message : '未知错误'), 'error');
    }
  }

  /* ---------------- 导入全库 JSON ---------------- */
  async function doImport(pwd?: string) {
    const file = await pickTextFile();
    if (!file) return;
    try {
      const result = await importEnvelope(file.text, pwd);
      await replaceLedger(result.data);
      setImporting(false);
      setImportPasswordNeeded(null);
      setImportPassword('');
      toast(`已恢复：${result.data.events.length} 场，${result.data.contacts.length} 户`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导入失败';
      if (msg.includes('密码')) {
        setImportPasswordNeeded(msg);
      } else {
        toast(msg, 'error');
      }
    }
  }

  /* ---------------- 导出 CSV ---------------- */
  async function exportEntriesCSV() {
    if (!ledger) return;
    const csv = entriesToCSV(ledger.entries, ledger.events, ledger.contacts);
    const r = await downloadText(tableFileName('人情账-全部条目', 'csv'), csv, 'text/csv');
    if (r.canceled) return;
    toast(r.ok ? (r.where ?? '条目已导出') : '导出失败：' + (r.error ?? ''), r.ok ? 'ok' : 'error');
  }

  async function exportContactsCSV() {
    if (!ledger) return;
    const rows = summarizeContacts(ledger.entries, ledger.contacts);
    const csv = contactsToCSV(rows);
    const r = await downloadText(tableFileName('人情账-户头汇总', 'csv'), csv, 'text/csv');
    if (r.canceled) return;
    toast(r.ok ? (r.where ?? '户头汇总已导出') : '导出失败：' + (r.error ?? ''), r.ok ? 'ok' : 'error');
  }

  return (
    <>
      <div className="page-head">
        <h1>设置</h1>
        <p>备份、加密、录入偏好都在这里。数据始终只存在本机。</p>
      </div>

      {/* ================= 数据概况 ================= */}
      <div className="card">
        <h3>账本概况</h3>
        <div className="grid grid-3">
          <div className="stat" style={{ boxShadow: 'none' }}>
            <div className="k">场次</div>
            <div className="v">{backupSummary?.events ?? 0}</div>
          </div>
          <div className="stat" style={{ boxShadow: 'none' }}>
            <div className="k">户头</div>
            <div className="v">{backupSummary?.contacts ?? 0}</div>
          </div>
          <div className="stat" style={{ boxShadow: 'none' }}>
            <div className="k">条目</div>
            <div className="v">{backupSummary?.entries ?? 0}</div>
          </div>
        </div>

        <Field label="这本账是谁家的">
          <div style={{ display: 'flex', gap: 9 }}>
            <input
              className="input"
              type="text"
              value={household}
              onChange={(e) => setHousehold(e.target.value)}
            />
            <button
              className="btn"
              onClick={() => {
                setHouseholdName(household);
                toast('已保存');
              }}
            >
              保存
            </button>
          </div>
        </Field>

        {usage ? (
          <div className="hint">
            已用存储 {formatBytes(usage.usage)}
            {usage.quota > 0 ? ` / 可用约 ${formatBytes(usage.quota)}` : ''}
          </div>
        ) : null}
      </div>

      {/* ================= 数据在哪 ================= */}
      <div className="card">
        <h3>数据在哪</h3>
        <div className="notice ok" style={{ marginTop: 0 }}>
          <strong>{location?.primary ?? '本机'}</strong>
          <div style={{ marginTop: 6 }}>
            备份导出到：<code>{location?.backups ?? '—'}</code>
          </div>
          {location?.exact ? (
            <div className="tiny" style={{ marginTop: 6, opacity: 0.75, wordBreak: 'break-all' }}>
              {location.exact}
            </div>
          ) : null}
        </div>

        {isDesktop() ? (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              className="btn"
              onClick={() => {
                void revealDataFolder().then((ok) =>
                  toast(ok ? '已打开数据文件夹' : '打不开文件管理器', ok ? 'ok' : 'warn'),
                );
              }}
            >
              打开数据文件夹
            </button>
            <button
              className="btn"
              onClick={() => {
                void chooseBackupDir().then((dir) => {
                  if (dir) {
                    setLocation(null);
                    void getDataLocation().then(setLocation);
                    toast('备份目录已改为 ' + dir);
                  }
                });
              }}
            >
              更改备份目录
            </button>
          </div>
        ) : null}

        {isAndroid() ? (
          <div className="hint">
            导出的备份在「文档/RenqingLedger」里，可以用系统「文件」App 找到，再拷到电脑。
          </div>
        ) : null}

        {version ? (
          <div className="hint">桌面版版本号 {version}</div>
        ) : null}
      </div>

      {/* ================= 备份与恢复 ================= */}
      <div className="card">
        <h3>备份与恢复</h3>
        <div className="notice info" style={{ marginTop: 0 }}>
          {platform() === 'desktop' ? (
            <>
              账本存在本机用户目录里，不在安装目录。换电脑、重装系统前
              <strong>请先导出备份</strong>。
            </>
          ) : isAndroid() ? (
            <>
              账本存在应用私有目录里，其他应用读不到。卸载应用会一起删掉，
              <strong>卸载前请先导出备份</strong>。
            </>
          ) : (
            <>
              数据只在这个浏览器里。换电脑、重装系统、清理浏览器数据都会丢，
              <strong>请定期导出备份</strong>。
            </>
          )}
        </div>

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => void exportJSON()}>
            {isAndroid() ? '保存备份到文件' : '导出全库备份（JSON）'}
          </button>
          <button className="btn" onClick={() => setImporting(true)}>
            从备份恢复
          </button>
          <button className="btn" onClick={() => go({ name: 'backup' })}>
            自动备份记录
          </button>
        </div>

        {isAndroid() ? (
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={() => {
                void (async () => {
                  const envelope = await exportEnvelope(ledger!, password ?? undefined);
                  const { shareText } = await import('@/platform');
                  const r = await shareText(
                    backupFileName(),
                    JSON.stringify(envelope, null, 2),
                  );
                  if (!r.canceled) toast(r.ok ? (r.where ?? '已分享') : '分享失败：' + (r.error ?? ''));
                })();
              }}
            >
              用系统分享发送备份
            </button>
          </div>
        ) : null}

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '16px 0' }} />

        <div className="btn-row">
          <button className="btn" onClick={exportEntriesCSV}>
            导出全部条目（CSV）
          </button>
          <button className="btn" onClick={exportContactsCSV}>
            导出户头汇总（CSV）
          </button>
          <button className="btn" onClick={() => void runAutoBackup().then(() => toast('已生成一份自动备份'))}>
            立即生成自动备份
          </button>
        </div>
        <div className="hint">CSV 带 UTF-8 BOM，Excel 双击直接打开，不会乱码。</div>
      </div>

      {/* ================= 应用锁 ================= */}
      <div className="card">
        <h3>应用锁（本地加密）</h3>
        {!cryptoAvailable() ? (
          <div className="notice warn">
            这个浏览器不支持 WebCrypto，无法启用加密。请换用较新的 Chrome / Edge / Firefox。
          </div>
        ) : encrypted ? (
          <>
            <div className="notice ok" style={{ marginTop: 0 }}>
              已开启。账本以 AES-GCM 加密后存在本机，密码用 Argon2id 派生，密码本身不落盘。
            </div>
            <div className="notice warn">
              <strong>密码忘了就打不开了。</strong>
              没有找回功能，也没有后门 —— 这是本地加密的代价。请把密码和备份一起保管好。
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setLockModal(true)}>
                修改密码
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  void changePassword(ledger, password ?? undefined, null).then(() => {
                    useStore.setState({ encrypted: false, password: null });
                    toast('已关闭加密，账本现在以明文存在本机');
                  });
                }}
              >
                关闭加密
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="notice warn" style={{ marginTop: 0 }}>
              当前账本是<strong>明文</strong>存在本机数据库里的。
              同一台{deviceWord()}上的其他人、或者能访问你{deviceWord()}数据的人，理论上可以读到姓名和金额。
              如果这台{deviceWord()}不只你一个人用，建议开启应用锁。
            </div>
            <button className="btn primary" onClick={() => setLockModal(true)}>
              设置密码并加密
            </button>
          </>
        )}
      </div>

      {/* ================= 录入偏好 ================= */}
      <div className="card">
        <h3>录入与还礼偏好</h3>

        <Field
          label="还礼建议取整到"
          hint="建议金额会对齐到这个档位，符合随礼习惯。"
        >
          <Segmented<'50' | '100'>
            value={String(settings.round_to) as '50' | '100'}
            onChange={(v) => updateSettings({ round_to: Number(v) as 50 | 100 })}
            options={[
              { value: '50', label: '50 元' },
              { value: '100', label: '100 元' },
            ]}
          />
        </Field>

        <Field
          label="每年上浮百分比"
          hint="考虑物价变化。默认 0，即不涨。白事不适用这条规则。"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              className="input"
              type="number"
              min={0}
              max={50}
              step={1}
              style={{ width: 110 }}
              value={settings.uplift_percent}
              onChange={(e) =>
                updateSettings({ uplift_percent: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <span className="muted">% / 年</span>
          </div>
        </Field>

        <Field
          label="大字号模式"
          hint="给父母用的时候调大一点，界面所有文字都会跟着变大。"
        >
          <Segmented<'1' | '1.15' | '1.3'>
            value={String(settings.font_scale) as '1' | '1.15' | '1.3'}
            onChange={(v) => updateSettings({ font_scale: Number(v) })}
            options={[
              { value: '1', label: '标准' },
              { value: '1.15', label: '大' },
              { value: '1.3', label: '特大' },
            ]}
          />
        </Field>

        <Field
          label="还礼建议区间下限"
          hint="关闭后，建议区间的下沿可以低于该户历史最低金额。"
        >
          <label className="small" style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={!settings.allow_below_history}
              onChange={(e) => updateSettings({ allow_below_history: !e.target.checked })}
            />
            下沿不低于历史最低（推荐）
          </label>
        </Field>
      </div>

      {/* ================= 危险操作 ================= */}
      <div className="card">
        <h3>其他</h3>
        <div className="btn-row">
          <button className="btn" onClick={() => setConfirmSeed(true)}>
            载入示例账本
          </button>
          <button className="btn danger" onClick={() => setConfirmWipe(true)}>
            清空本机全部数据
          </button>
        </div>
        <div className="hint">{SEED_NOTICE}载入示例会覆盖当前账本，请先导出备份。</div>
      </div>

      <div className="card">
        <h3>隐私说明</h3>
        <ul className="basis" style={{ marginTop: 0 }}>
          <li>这个应用不发起任何网络请求，没有账号系统，没有第三方统计。</li>
          <li>数据存在浏览器的 IndexedDB 里，位置由浏览器管理，其他网站读不到。</li>
          <li>日志只记录数量级信息，不打印姓名与金额。</li>
          <li>删除一律是软删除，导出备份里仍然保留，方便误删恢复。</li>
        </ul>
      </div>

      {/* ================= 弹窗 ================= */}
      {confirmWipe ? (
        <ConfirmModal
          title="清空全部数据"
          danger
          confirmText="确认清空"
          message={
            <>
              这会删除本机上的账本、设置和<strong>全部自动备份</strong>，无法恢复。
              <div className="hint" style={{ marginTop: 8 }}>
                强烈建议先点「导出全库备份（JSON）」存一份。
              </div>
            </>
          }
          onCancel={() => setConfirmWipe(false)}
          onConfirm={() => {
            setConfirmWipe(false);
            void wipe();
          }}
        />
      ) : null}

      {confirmSeed ? (
        <ConfirmModal
          title="载入示例账本"
          confirmText="载入"
          message={
            <>
              载入示例会<strong>覆盖当前账本</strong>。
              <div className="hint" style={{ marginTop: 8 }}>{SEED_NOTICE}</div>
            </>
          }
          onCancel={() => setConfirmSeed(false)}
          onConfirm={() => {
            setConfirmSeed(false);
            void loadSeed();
          }}
        />
      ) : null}

      {lockModal ? (
        <PasswordModal
          hasExisting={encrypted}
          onClose={() => setLockModal(false)}
          onSubmit={async (newPwd) => {
            await changePassword(ledger, password ?? undefined, newPwd);
            useStore.setState({ encrypted: true, password: newPwd });
            setLockModal(false);
            toast('已加密，下次打开需要输入密码');
          }}
        />
      ) : null}

      {importing ? (
        <Modal
          title="从备份恢复"
          onClose={() => {
            setImporting(false);
            setImportPasswordNeeded(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setImporting(false);
                  setImportPasswordNeeded(null);
                }}
              >
                取消
              </button>
              {importPasswordNeeded ? (
                <button className="btn primary" onClick={() => void doImport(importPassword)}>
                  用这个密码恢复
                </button>
              ) : (
                <button className="btn primary" onClick={() => void doImport()}>
                  选择备份文件
                </button>
              )}
            </>
          }
        >
          <div className="notice warn" style={{ marginTop: 0 }}>
            恢复会<strong>覆盖当前账本</strong>。如果当前数据还有用，请先导出一份。
          </div>

          {importPasswordNeeded ? (
            <>
              <div className="notice info">{importPasswordNeeded}</div>
              <Field label="备份密码">
                <input
                  className="input"
                  type="password"
                  value={importPassword}
                  autoFocus
                  onChange={(e) => setImportPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void doImport(importPassword);
                  }}
                />
              </Field>
            </>
          ) : (
            <div className="hint">
              选择之前导出的 <code>.json</code> 备份文件。如果那份备份设了密码，会再让你输入一次。
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

/* ================================================================== 自动备份页 */

export function BackupPage({ go }: { go: (r: Route) => void }) {
  const toast = useStore((s) => s.toast);
  const replaceLedger = useStore((s) => s.replaceLedger);
  const [list, setList] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [pwd, setPwd] = useState('');

  async function refresh() {
    setLoading(true);
    setList(await listAllBackups());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function doRestore(rec: BackupRecord, password?: string) {
    try {
      const data = await restoreFromBackup(rec.id, password);
      await replaceLedger(data);
      setRestoreTarget(null);
      setNeedPassword(false);
      setPwd('');
      toast('已恢复到这份备份');
      go({ name: 'home' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '恢复失败';
      if (msg.includes('密码')) setNeedPassword(true);
      else toast(msg, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <button className="btn ghost sm" onClick={() => go({ name: 'settings' })}>
          ← 设置
        </button>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <h3 style={{ marginBottom: 4 }}>自动备份</h3>
            <p className="small muted" style={{ margin: 0 }}>
              每次打开应用会自动存一份，同一天只存一份，最多保留最近 20 份。
            </p>
          </div>
          <button className="btn sm" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card">
          <div className="hint">读取中…</div>
        </div>
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState icon="💾" title="还没有自动备份">
            下次打开应用时会自动生成一份。也可以到设置里点「立即生成自动备份」。
          </EmptyState>
        </div>
      ) : (
        <div className="card tight">
          <div className="list">
            {list.map((rec) => (
              <div key={rec.id} className="list-item">
                <div className="mid">
                  <div className="title" style={{ fontSize: '0.95em' }}>
                    {formatCN(rec.created_at.slice(0, 10))}
                    <span className="muted small">
                      {rec.created_at.slice(11, 16)}
                    </span>
                    {rec.encrypted ? <span className="tag">已加密</span> : null}
                  </div>
                  <div className="meta">{formatBytes(rec.size)}</div>
                </div>
                <div className="right" style={{ display: 'flex', gap: 7 }}>
                  <button className="btn sm" onClick={() => setRestoreTarget(rec)}>
                    恢复
                  </button>
                  <button
                    className="btn sm danger"
                    onClick={() => setDeleteTarget(rec)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {restoreTarget ? (
        <Modal
          title="恢复这份备份"
          onClose={() => {
            setRestoreTarget(null);
            setNeedPassword(false);
            setPwd('');
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setRestoreTarget(null);
                  setNeedPassword(false);
                }}
              >
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => void doRestore(restoreTarget, pwd || undefined)}
              >
                恢复
              </button>
            </>
          }
        >
          <div className="notice warn" style={{ marginTop: 0 }}>
            恢复会<strong>覆盖当前账本</strong>。当前数据会先被自动备份一份。
          </div>
          <div className="small">
            备份时间：{formatCN(restoreTarget.created_at.slice(0, 10))}{' '}
            {restoreTarget.created_at.slice(11, 19)}
          </div>

          {needPassword || restoreTarget.encrypted ? (
            <Field label="备份密码">
              <input
                className="input"
                type="password"
                value={pwd}
                autoFocus
                onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doRestore(restoreTarget, pwd);
                }}
              />
            </Field>
          ) : null}
        </Modal>
      ) : null}

      {deleteTarget ? (
        <ConfirmModal
          title="删除这份备份"
          danger
          confirmText="删除"
          message="删除后无法恢复，其他备份不受影响。"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            void removeBackup(deleteTarget.id).then(() => {
              setDeleteTarget(null);
              void refresh();
              toast('已删除');
            });
          }}
        />
      ) : null}
    </>
  );
}

/* ================================================================== 密码弹窗 */

function PasswordModal({
  hasExisting,
  onClose,
  onSubmit,
}: {
  hasExisting: boolean;
  onClose: () => void;
  onSubmit: (pwd: string) => Promise<void>;
}) {
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);

  const hint = pwd ? passwordHint(pwd) : null;
  const mismatch = pwd2.length > 0 && pwd !== pwd2;
  const canSubmit = pwd.length >= 6 && pwd === pwd2 && !busy;

  return (
    <Modal
      title={hasExisting ? '修改密码' : '设置密码并加密'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!canSubmit}
            onClick={() => {
              setBusy(true);
              void onSubmit(pwd).finally(() => setBusy(false));
            }}
          >
            {busy ? '正在加密…' : hasExisting ? '修改' : '加密'}
          </button>
        </>
      }
    >
      <div className="notice warn" style={{ marginTop: 0 }}>
        <strong>密码忘了就打不开。</strong>
        没有找回、没有后门。请把密码和备份文件分开保管。
      </div>

      <Field label="密码" hint={hint ?? '至少 6 位，建议字母加数字'}>
        <input
          className="input"
          type="password"
          value={pwd}
          autoFocus
          onChange={(e) => setPwd(e.target.value)}
        />
      </Field>

      <Field label="再输一次">
        <input
          className="input"
          type="password"
          value={pwd2}
          onChange={(e) => setPwd2(e.target.value)}
        />
      </Field>

      {mismatch ? (
        <div className="hint" style={{ color: 'var(--danger)' }}>
          两次输入不一样
        </div>
      ) : null}

      <div className="hint">
        加密方式：Argon2id 派生密钥 → AES-GCM 加密整个账本。
        派生参数存在本机，密码本身不落盘。加密过程需要一两秒。
      </div>
    </Modal>
  );
}

/* ================================================================== 工具 */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 供外部复用 */
export { formatCents };
