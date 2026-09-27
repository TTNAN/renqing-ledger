# Android 签名说明

本文说明如何为「人情账」Android 版生成签名密钥、如何注入签名，以及密钥的保管要求。

> **核心原则：`*.jks`、`*.keystore`、`keystore.properties` 一律不进 git。**
> 已在 `.gitignore` 里忽略。密钥一旦泄露，任何人都能冒名发布你的应用更新。

---

## 一、为什么要签名

Android 要求每个 APK 都用密钥签名。系统靠签名判断：

- 这个包是谁发的
- 两个包能不能互相覆盖安装（签名必须一致）

**同一应用的每次更新必须用同一把密钥签名**，否则用户只能卸载重装（会丢数据）。

---

## 二、生成 keystore

需要 JDK（`keytool` 随 JDK 提供）。

```powershell
# 在项目根目录执行
keytool -genkeypair -v `
  -keystore android/renqing-release.jks `
  -alias renqing `
  -keyalg RSA -keysize 2048 -validity 10950 `
  -storetype PKCS12 `
  -dname "CN=RenqingLedger, OU=Personal, O=Personal, L=Shanghai, ST=Shanghai, C=CN"
```

参数说明：

| 参数 | 含义 |
|---|---|
| `-validity 10950` | 有效期 30 年。Google Play 要求至少到 2033 年 |
| `-storetype PKCS12` | 现代格式，JDK 9+ 默认 |
| `-alias renqing` | 密钥别名，后面要一致 |
| `-dname` | 证书主体信息，个人项目随便填 |

执行后会让你输入两次**库口令**和**密钥口令**（PKCS12 下两者通常相同）。

> 找不到 `keytool`？它在 `%JAVA_HOME%\bin\` 下。
> 本机若用过 `E:\renqingzhang\tools\jdkraw\` 那套 JDK，可以用：
> `E:\renqingzhang\tools\jdkraw\jdk-17.0.20.1+1\bin\keytool.exe`

---

## 三、注入签名（两种方式，任选其一）

### 方式 A：环境变量（推荐，适合 CI）

```powershell
$env:RENQING_KEYSTORE          = "android/renqing-release.jks"
$env:RENQING_KEYSTORE_PASSWORD = "你的库口令"
$env:RENQING_KEY_ALIAS         = "renqing"
$env:RENQING_KEY_PASSWORD      = "你的密钥口令"

pnpm build:android
```

### 方式 B：keystore.properties（推荐，适合本地日常）

在 `android/` 下新建 `keystore.properties`：

```properties
storeFile=renqing-release.jks
storePassword=你的库口令
keyAlias=renqing
keyPassword=你的密钥口令
```

`storeFile` 相对于 `android/` 目录。这个文件已在 `.gitignore` 中。

然后直接：

```powershell
pnpm build:android
```

### 都没配置会怎样

`pnpm build:android` 仍然能跑通，但 release 产出的是
`人情账-0.2.0-release-unsigned.apk`，**这个包无法直接安装**。
脚本会在结尾明确提示。

想确认当前用的是哪套配置：

```powershell
cd android
.\gradlew printSigningInfo
```

---

## 四、GitHub Actions 注入 secrets

在仓库 Settings → Secrets and variables → Actions 里加四个 secret：

| Secret 名 | 值 |
|---|---|
| `RENQING_KEYSTORE_BASE64` | keystore 文件的 base64 |
| `RENQING_KEYSTORE_PASSWORD` | 库口令 |
| `RENQING_KEY_ALIAS` | 别名 |
| `RENQING_KEY_PASSWORD` | 密钥口令 |

生成 base64：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("android\renqing-release.jks")) | Set-Clipboard
```

工作流里解码（见 `.github/workflows/build-android.yml`）：

```yaml
- name: 还原 keystore
  if: ${{ secrets.RENQING_KEYSTORE_BASE64 != '' }}
  run: echo "${{ secrets.RENQING_KEYSTORE_BASE64 }}" | base64 -d > android/renqing-release.jks
```

**没有配 secrets 时**，工作流会打未签名包并上传，不会失败。

---

## 五、验证签名

```powershell
# 用 Android SDK 里的 apksigner
& "$env:ANDROID_HOME\build-tools\34.0.0\apksigner.bat" verify --print-certs `
  release-android\人情账-0.2.0-release.apk
```

应该看到 `Signer #1 certificate DN` 与你的 `-dname` 一致。

`pnpm build:android` 在有签名时会自动跑一次校验并打印结果。

---

## 六、密钥保管（重要）

**keystore 丢了会怎样：**

- 已经发出去的 APK 无法再更新（新包签名不同，系统拒绝覆盖安装）
- 只能换个包名重新发布，老用户要卸载重装并手动迁移数据

**建议：**

1. 把 `.jks` 文件备份到至少两个地方（加密网盘 + U 盘）
2. 口令单独存（密码管理器），不要和 `.jks` 放一起
3. 不要提交进 git，不要贴到聊天工具里
4. 如果怀疑泄露，立刻换新密钥重新发布（代价同上）

---

## 七、常见问题

**Q：`keystore.properties` 写了但没生效？**

检查路径。`storeFile` 是相对 `android/` 目录的，不是项目根目录。

**Q：Gradle 报 `Keystore was tampered with, or password was incorrect`？**

口令错了。注意 PKCS12 格式下如果库口令与密钥口令不同，某些 JDK 版本会报这个。

**Q：想让 debug 包也能覆盖安装？**

`app/build.gradle` 里 debug 配置了 `applicationIdSuffix ".debug"`，
所以 debug 与 release 是两个不同的包，可以并存。这是刻意的。

**Q：`pnpm build:android` 报找不到 JDK / Android SDK？**

脚本会按顺序找：环境变量 `JAVA_HOME` / `ANDROID_HOME`，
其次找 `E:\renqingzhang\tools\`（之前为别的项目准备的工具链），
最后找默认安装位置。都没有就手动设：

```powershell
$env:JAVA_HOME    = "C:\Program Files\Eclipse Adoptium\jdk-17.x.x"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```
