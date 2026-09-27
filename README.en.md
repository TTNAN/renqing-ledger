<div align="center">

# RenqingLedger · 人情账

**A fully offline ledger for Chinese gift-money (人情往来).**

Record who gave what at whose wedding — and know exactly how much to give back next time.

[![Tests](https://github.com/TTNAN/renqing-ledger/actions/workflows/test.yml/badge.svg)](../../actions/workflows/test.yml)
[![Windows](https://github.com/TTNAN/renqing-ledger/actions/workflows/build-windows.yml/badge.svg)](../../actions/workflows/build-windows.yml)
[![Android](https://github.com/TTNAN/renqing-ledger/actions/workflows/build-android.yml/badge.svg)](../../actions/workflows/build-android.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**[简体中文](./README.md) | English**

</div>

---

## What is this

In China, when a family holds a wedding, a baby shower, or a funeral, relatives and
friends give cash gifts (随礼 / 礼金). You're expected to give back a comparable
amount when *they* hold an event — sometimes years later.

Most families track this in a paper notebook, or in a phone app that wants an
account, a phone number, and your data on their servers.

**RenqingLedger is a local-first ledger for exactly this.** It runs on your own
device, never talks to a server, and answers the one question that actually
matters:

> **"They're holding a wedding next month — how much should I give?"**

|  | Cloud ledger apps | RenqingLedger |
|---|---|---|
| Where's the data | Their servers | **Your device** |
| Account required | Yes, usually a phone number | **No** |
| Works offline | Usually not | **Yes — it never goes online** |
| Who can see it | Vendor, ops staff, any breach | **Only you** |
| If the service shuts down | Data may be gone | **Unaffected** |
| Cost | Free tier + subscription | **Free, MIT-licensed** |

The names, amounts, and family relationships in a gift ledger are private.
"Who gave how much" leaking is more awkward than a credit-card statement.
Keeping it on your own device is the simplest answer.

---

## Screenshots

### Desktop (Windows)

![Desktop home](docs/images/screenshot-desktop-home.png)

### Mobile (Android)

<p align="center">
  <img src="docs/images/screenshot-android.png" width="240" alt="Android home">
  <img src="docs/images/screenshot-android-add.png" width="240" alt="Record an entry">
  <img src="docs/images/screenshot-android-settings.png" width="240" alt="Settings">
</p>

The mobile build is adapted rather than ported: no top bar (the title lives on
the home page and "record" is in the bottom nav), phone-appropriate wording,
and file export instead of printing.

### The core feature: how much should I give back?

![Suggest](docs/images/screenshot-suggest.png)

It never gives you a bare number — every suggestion comes with its reasoning:

> 2023-05-01 — they held a **wedding**, you gave ¥800.
> They've given you ¥1,200 in total, you've given them ¥1,100 — they're ¥100 ahead.
> To not fall below their most recent ¥1,200, this suggestion uses that value.
> Rounded to the nearest ¥100 → ¥1,200
>
> **Suggestion: ¥1,100 – ¥1,300**

### Ledger sheet: one-tap export to PDF or image

![Ledger sheet](docs/images/screenshot-sheet.png)

What you see in the preview is what you get — phones can save it as a PDF or
an image directly. Past 22 rows it paginates automatically, with the header
repeated on every page.

---

## Download & install

Three forms. **They're independent — each has its own ledger.**

### Windows — installer (.exe)

1. Download `RenqingLedger-Setup-<version>.exe` from [Releases](../../releases)
2. Double-click to install. **Installs per-user — no admin rights needed**
3. Optionally check "create desktop shortcut"

**About the SmartScreen warning:**

The installer is **not code-signed** (a certificate costs money, and this is a
personal project). Windows shows "Windows protected your PC" on first run.
This is expected:

> Click **"More info"** → click **"Run anyway"**

You only need to do this once.

**Where things live:**

| | Location |
|---|---|
| Program | `%LOCALAPPDATA%\Programs\人情账\` |
| **Your ledger** | **`%APPDATA%\RenqingLedger\`** |

The data is **not** in the install directory, so uninstalling and reinstalling
won't lose your ledger.

**On uninstall**, you'll be asked whether to also delete the ledger data.
The default is **"No"** (keep it).

### Android — APK

1. Download `人情账-<version>-release.apk` from [Releases](../../releases)
2. Tap it on your phone; allow "install from unknown sources" when prompted
3. An app named **人情账** appears on your home screen

**Permissions**: only `INTERNET`, which Capacitor's WebView bridge needs.
The app code makes **no upload requests** and contains no analytics SDK.
See [Privacy](#privacy).

**Your ledger lives in the app's private storage** (other apps can't read it).
Uninstalling deletes it — so **export a backup first** (「我的 → 保存备份到文件」).

**Where exports go**: `Documents/RenqingLedger/`. Findable with the system Files
app, or use "share via system" to send it straight to WeChat / email / your PC.

### Browser — single HTML file

```bash
pnpm install && pnpm build:single
```

Produces `人情账.html` (~700 KB). **Just double-click it.** No Node, no server,
no internet needed.

> ⚠️ Don't double-click the `index.html` in the project root — that's the source
> entry for `pnpm dev`. Use the built `人情账.html`.
>
> ⚠️ Don't move that file around. Browsers isolate storage by file path, so
> moving it makes the ledger *look* empty. Export a backup before moving.

### Moving to a new device

The three forms are **independent** — data does not sync between them.
Migrate with a backup file:

```
Old device → Settings → Export backup (.json)
           → transfer the file (WeChat / USB / cloud drive)
New device → Restore from backup → pick that .json
```

On first launch with an empty ledger, you'll see three options:
**import a backup / load sample data / start blank**.

---

## Features

**Ledger core**

- **Events** (场次): 13 types — wedding, baby shower, 100-day, first birthday,
  birthday/banquet, housewarming, opening, school, graduation, hospital visit,
  funeral, holiday, other
- **Households** (户头): one entry per *family*, not per contact-card fragment.
  Supports **aliases** (so searching "三舅" finds "张叔"), relationship, family
  branch, phone, notes
- **Entries**: direction (give/receive), cash + optional gifts with valuation,
  payment method, handler, notes
- Soft deletes throughout — statistics exclude them, history is preserved

**Gift-return suggestions** (the differentiator)

- Pure function in `src/domain/suggest.ts` — no React, no database, no clock
- Rules: same-event-type history first → their most recent gift to you →
  your most recent gift; a net-positive balance raises the floor;
  **funerals use separate rules** (no auto-escalation);
  optional yearly uplift; rounding to 50 or 100
- **Always shows its reasoning** — never a black-box number
- "Simulate" mode: change the event type and it recalculates without writing anything
- Gift valuations are **excluded** from cash suggestions (mentioned in reasoning only)

**Search & stats**

- Global search across names, aliases, branches, notes, event titles
- Household page: totals, timeline, simulated suggestion
- Merge duplicate households (history moves over, old name becomes an alias)
- Yearly totals, by-type, by-relationship, monthly bar chart

**Ledger sheet & export**

- **Ledger sheet** (礼簿) for your own events: A4 layout, ready to print for elders
- **All three targets can export — not just desktop**:
  - **Save PDF** — generates a real PDF file, works on phones too
  - **Save images** — exports PNG, ideal for WeChat or group chats
    (no reader needed on the receiving end)
  - **Print** — desktop and browser only (Android WebView has no print
    subsystem, so the button isn't shown there)
- **Auto-paginates past 22 rows**: every page repeats the header,
  the total appears only on the last page
- Header, column widths and margins are tuned for A4.
  **What you see in the preview is exactly what you get** — all three
  targets produce identical output
- CSV export with UTF-8 BOM — opens correctly in Excel on double-click
- Full JSON backup & restore, optionally encrypted

**Privacy & security**

- Local only: no network requests, no account, no analytics
- Optional app lock: **Argon2id** key derivation → **AES-GCM** encryption
- Automatic local backups (one per day, keeps the latest 20)
- Logs never print names or amounts

**Usability**

- Fast entry: event → person → amount → **Enter** (on phones, the
  "Save & continue" button instead — soft keyboards vary)
- Amount input accepts Chinese conventions and decimals:
  `800`, `800元`, `800.50`, `捌佰`, `一千二`, `三块五`
- Create households inline while typing; keyboard-only workflow
- Large-font mode (normal / large / extra-large)
- One-click fictional sample data
- Confirm dialogs on every delete
- Funeral events automatically get a muted color scheme
- **Mobile-specific adaptation**: bottom nav instead of a top bar,
  touch targets ≥44px, phone-appropriate wording, file export instead of print

---

## Privacy

- **No network requests.** No fetch, no XHR, no WebSocket, no telemetry
- **No account system.** No phone number, no email, no identity collection
- **No third-party analytics SDK**
- Data is written only to local storage (browser IndexedDB / Electron user data
  dir / Android app-private storage)
- Logs never print names or amounts
- Deletes are **soft** (`deleted_at`); backups still contain them, so mistakes
  are recoverable
- Backup files contain names and amounts **in plaintext** unless you enable encryption
- Android **disables system auto-backup** (`allowBackup=false`) so the ledger is
  never uploaded to Google Drive — use the in-app export to migrate

### About Android's INTERNET permission

The APK requests `android.permission.INTERNET`. This is required by Capacitor's
WebView bridge (the native layer talks to the web layer over a local
`https://localhost` URL, which goes through the network stack).

**It is not used to upload your ledger.** Three reasons:

1. The app code contains no calls to remote addresses, and no analytics SDK
2. The ledger lives in app-private storage; exports go through the system file
   picker and the Documents directory — never over the network
3. Verify it yourself: open DevTools → Network, or run a packet capture.
   You'll see only local resource loads

If you want a hard network block, comment out that line in
`android/app/src/main/AndroidManifest.xml` and rebuild. The tradeoff is that
Capacitor's plugin bridge stops working (file export/import breaks), which is
why it's kept by default.

### Desktop

The Electron main process disables Node in the renderer (`contextIsolation: true`)
and exposes only 8 explicit methods via preload (save-as, open-file, path queries).
External links open in the system browser, never in-app.

---

## How the suggestion algorithm works

A **pure function**: given one household's entries and a target event type, it
returns a suggested range + reasoning + warnings. It doesn't touch React, the
database, or the system clock — which is why it can be exhaustively tested.

Priority order:

1. **Same event type first** — if they held a wedding before, use what you gave then
2. Otherwise, **their most recent gift to you**
3. Otherwise, **your most recent gift**
4. **Net-positive and you're giving**: don't fall below their most recent gift
5. **Funerals use separate rules**: no escalation from a positive balance,
   never below the household's historical minimum, plus a notice that this is
   historical reference only
6. **Yearly uplift** (configurable, default 0%)
7. **Rounding** to 50 or 100 (configurable)
8. **Range** = primary ± one step, floor not below the household's historical minimum

Gift valuations are **excluded** from the cash suggestion and mentioned only in
the reasoning ("also brought a bottle of liquor, valued ~¥1,500").

### Worked example

> **Zhang Shu's household:** at your 2021 wedding he gave ¥1,200;
> at his son's 2023 wedding you gave ¥800; at his 2024 housewarming you gave ¥300.
>
> Now his daughter is getting married. The app suggests **¥1,100 – ¥1,300**:
> - 2023-05-01 — they held a "wedding", you gave ¥800
> - They've given ¥1,200 total, you've given ¥1,100 — they're ¥100 ahead;
>   to not fall below their most recent ¥1,200, this uses that value
> - Rounded to the nearest ¥100 → ¥1,200

**This is a reference, not advice.** Regional customs vary enormously.
Funerals especially — the app only shows historical numbers and makes no judgment.

---

## Running from source

Requires [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm dev          # dev server with HMR → http://localhost:5273
# or
pnpm build && pnpm start    # production, served locally
```

`pnpm start` binds to `127.0.0.1` only. Add `--open` to launch a browser:
`node scripts/serve.mjs --open`

### Why does double-clicking the source `index.html` show a blank page?

Browsers refuse to load **ES Modules over `file://`** (a security rule; you'll
see a CORS error in the console). The regular build emits `<script type="module">`,
so double-clicking `dist/index.html` is blank too.

`pnpm build:single` solves this: it inlines all JS and CSS into one HTML file and
switches to a classic (IIFE) script. Verified: IndexedDB and WebCrypto both work
under `file://`, so the single-file build **really does persist data** — it's not
a demo toy.

---

## FAQ

**I installed it and it's empty — where's my old ledger?**

The three forms (browser / desktop / Android) are **independent**; data does not
sync. If you recorded entries in the browser version, the desktop version won't
see them — use "restore from backup". Different package IDs also mean a fresh
container.

**Android: I exported but can't find the file.**

It's in `Documents/RenqingLedger/`. Open the system Files app → Documents.
Or use "share via system" in Settings to send it to WeChat / email directly.

**Should I save the ledger sheet as PDF or as an image?**

Depends on what it's for:

- **Sending to family** → image. It just shows up in WeChat; no reader needed
- **Printing or archiving** → PDF. A4 layout, ready for a print shop
- **Printing directly on desktop** → hit "Print"; the output matches the PDF exactly

Past 22 rows it paginates automatically. Multi-page image exports are saved
as several files with page numbers in the name.

**Why is there no "Print" button on phones?**

Android WebView has no print subsystem — `window.print()` is a no-op (nothing
happens when tapped). So phones use "Save PDF" instead: same result, but as a
file, which is easier to share anyway.

**The text in the exported PDF isn't selectable?**

It's an image-based PDF (each page is a high-res image wrapped in a PDF). This
is deliberate: text PDFs would require embedding a CJK font, and one font file
is 5-10 MB — it would balloon the 4 MB APK to well over ten. The trade-off is
no text selection or search, but printing and reading work perfectly.

**Will upgrading overwrite my data?**

No. The ledger lives in the user data directory / app-private storage, separate
from the program. Uninstall/reinstall preserves it (Windows asks before deleting;
Android deletes on uninstall — **export first**).

On version upgrades, `normalizeLedger()` fills in missing fields. Older
(schema 1) data is never overwritten or cleared by a newer version.

**Windows says "Windows protected your PC".**

The installer isn't code-signed. Click "More info" → "Run anyway". Only on first run.

**Android says "unknown sources".**

Normal for self-signed APKs. Allow it once in settings.

**Can it back up to the cloud?**

No, deliberately. There is no cloud sync code. Export a `.json` to your own
cloud drive / USB stick and import it when needed.

**I forgot my password.**

You can't get in. There's no recovery and no backdoor — that's the cost of local
encryption. Restore from an earlier export instead (if that one wasn't encrypted).

**Why is the installer 80 MB?**

Electron bundles an entire Chromium. That's the inherent cost of a desktop shell.
If size matters, Tauri 2 would produce ~5 MB from the same frontend, but it
requires a Rust toolchain. See the roadmap.

---

## Architecture

```
ui/  ──────▶ store/ ──────▶ storage/ ──────▶ IndexedDB
 │                              │                  │
 │                              └──────▶ platform/ ┘
 │                                          │
 └────────▶ domain/ ◀───────────────────────┘
              (pure functions)      (filesystem / native dialogs)
```

Dependencies flow one way: `ui → store → storage → platform`.
`domain` is used by everyone and uses no one.

```
src/
├── domain/          pure logic, zero React
│   ├── types.ts       domain types (event / household / entry / settings)
│   ├── money.ts       integer-cent arithmetic, Chinese numeral parsing
│   ├── date.ts        YYYY-MM-DD + Asia/Shanghai
│   ├── suggest.ts     ★ gift-return algorithm (pure function)
│   ├── stats.ts       aggregations
│   ├── export.ts      ledger sheet / CSV generation
│   ├── sheetCanvas.ts ledger sheet rendered to Canvas (shared by all targets)
│   └── pdf.ts         PDF writer (hand-rolled, image-based, multi-page)
├── storage/         persistence
│   ├── db.ts          IndexedDB wrapper
│   ├── repo.ts        repository: read/write, backup, import/export
│   ├── crypto.ts      Argon2id + AES-GCM
│   └── seed.ts        fictional sample data
├── platform/        three-target adapter
│   ├── index.ts       platform detection + file save/open dispatch
│   └── androidFiles.ts  Android: Documents dir + system share + SAF
├── store/           Zustand global state
└── ui/              interface
    ├── router.ts      ~60-line hash router
    ├── components/    shared components (incl. mobile bottom nav)
    └── pages/         nine pages

electron/            Windows desktop shell
├── main.cjs           main process: window / file dialogs / data dir
└── preload.cjs        bridge exposing exactly 8 methods

android/             Capacitor native project
docs/
└── android-signing.md signing guide
```

### Hard rules

1. **Money is integer cents internally.** `amount_cents` means cents;
   all arithmetic, storage and comparison use integers, so floating-point
   drift (`0.1 + 0.2 !== 0.3`) can never accumulate in your ledger.
   **Input may contain decimals** (`800.50`, `三块五`, `捌佰` are all accepted),
   but the conversion happens at exactly one entry point — `money.ts` —
   and everything past it is integer cents
2. **Dates are `YYYY-MM-DD` strings.** Fixed-length lexicographic order equals
   chronological order, avoiding `Date` timezone traps. "Today" comes from
   `Intl.DateTimeFormat` in Asia/Shanghai
3. **Deletes are soft.** Every entity has `deleted_at`; stats exclude them by default
4. **The suggestion algorithm never enters a component.** It lives in
   `domain/suggest.ts`; changing it requires changing `suggest.test.ts`
5. **No dependency that makes network requests.** This is a product promise
6. **Platform differences live only in `platform/`.** Components may branch for
   copy tweaks, never for capabilities
7. **The ledger sheet has exactly one layout.** Preview, print, exported PDF
   and exported images all go through `domain/sheetCanvas.ts`.
   Never write a second renderer — print used to go through CSS while export
   went through Canvas, and the two produced visibly different output

---

## Testing

The suggestion algorithm, money parsing and PDF structure are all pure
functions with unit-test coverage; each of the three targets has its own
end-to-end verification.

| Layer | Coverage |
|---|---|
| Unit tests | **73 cases** |
| Browser | 26 checks, real browser + real IndexedDB via CDP |
| Single-file | 8 checks, `file://` double-click scenario |
| Desktop | 12 checks, launches the packaged exe |
| Android container | 13 checks, phone viewport + touch targets |

Unit test breakdown:

| File | Covers |
|---|---|
| `suggest.test.ts` | 15 cases for the suggestion algorithm (funeral floor, gift exclusion, …) |
| `money.test.ts` | 17 cases for money utilities |
| `decimal.test.ts` | 15 cases for decimal parsing and display |
| `pdf.test.ts` | 16 cases for PDF structure (incl. multi-page xref offsets) |
| `sheetLayout.test.ts` | 10 cases for ledger-sheet column widths |

**All four end-to-end suites assert the same thing**: the suggestion must be
`¥1,100 – ¥1,300`. Any target computing it differently fails the build.

### Why PDF structure gets its own tests

The PDF writer is hand-rolled (to avoid pulling in jsPDF's ~300 KB), so a
single wrong byte makes the file unopenable. The trickiest part is the
**xref table**: every object's byte offset must be exact. `pdf.test.ts`
verifies, for each object, that the file really contains `N 0 obj` at
the recorded offset.

### Known limitations

- **The APK has not been installed on a physical device**: the dev machine has no
  Android emulator image, so Android-side verification runs in a 390×844 viewport
  simulating the WebView environment. This catches "the package doesn't run at
  all" but not device-specific issues (such as font-width differences between
  OEM builds)
- **The Windows installer is not code-signed**: SmartScreen will warn, see above
- Electron output is 80 MB (bundles Chromium)

---

## Roadmap

- [ ] **Parse WeChat chat logs** into entries. Optional module, off by default
- [ ] **Multiple ledgers** — one for yourself, one for your parents
- [ ] **Mobile offline polish** — PWA / better Capacitor integration
- [ ] **Tauri 2 shell** — ~5 MB instead of 80 MB (needs Rust)
- [ ] **SQLite storage** — for very large ledgers (the storage layer is isolated)
- [ ] **Photo attachments** — photograph a paper ledger sheet
- [ ] **Import old ledgers** from Excel / WeChat export files

---

## Contributing

Issues and PRs welcome. A few conventions:

- Money is **integer cents internally** (input accepts decimals; conversion lives in `money.ts`)
- Changes to the suggestion algorithm **must add unit tests** (`src/domain/suggest.test.ts`)
- **Ledger-sheet layout changes belong in one place**: `src/domain/sheetCanvas.ts`.
  Preview, print and export all share it — don't write a second renderer
- UI copy is everyday Chinese; avoid financial-app jargon like 交易/商户/SKU/流水号
- Don't add dependencies that make network requests
- Before submitting: `pnpm test && pnpm typecheck && pnpm build`

---

## Support

If this saved you from an awkward "how much did they give us again?" moment,
you're welcome to buy me a coffee. Entirely optional — the app is and will
remain free and MIT-licensed.

<div align="center">

<table>
<tr>
<td align="center" width="50%">

**WeChat · 微信**

<img src="docs/images/wechat.png" width="260" alt="WeChat QR">

</td>
<td align="center" width="50%">

**Alipay · 支付宝**

<img src="docs/images/alipay.png" width="260" alt="Alipay QR">

</td>
</tr>
</table>

</div>

---

## License

[MIT](./LICENSE)

The sample ledger data (names, amounts, locations) is **entirely fictional** and
unrelated to any real person or family.
