/**
 * 人情账 · Electron 主进程
 *
 * 职责边界很清晰：只管窗口和文件系统，不碰任何业务逻辑。
 * 前端仍然是一个普通的 Vite 应用，通过 preload 暴露的桥调用这里。
 *
 * 几个刻意的决定：
 *   1. 数据放 app.getPath('userData')，即 %APPDATA%/RenqingLedger/
 *      —— 绝不写进 Program Files，那里普通用户没有写权限
 *   2. 不引入任何联网代码，也不做自动更新检查
 *      —— 产品承诺是「不联网」，检查更新会破坏这个承诺
 *   3. 窗口大小位置记在本地配置文件里，下次打开还原
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

/**
 * 固定用户数据目录名。
 *
 * 默认 app.getPath('userData') 用的是 package.json 的 name（renqing-ledger），
 * 那样目录名是小写连字符，用户不好认。这里显式改成 RenqingLedger，
 * 于是数据落在 %APPDATA%\RenqingLedger\。
 *
 * 必须在 app ready 之前设置，否则不生效。
 */
app.setName('RenqingLedger');
app.setPath('userData', path.join(app.getPath('appData'), 'RenqingLedger'));

/** 打包后 __dirname 是 resources/app.asar/electron，开发时是 <repo>/electron */
const isDev = !app.isPackaged;
const DEV_URL = process.env.RENQING_DEV_URL || 'http://localhost:5273';

/** 备份目录配置文件 */
function configPath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/** 默认备份目录：%APPDATA%/RenqingLedger/backups/ */
function defaultBackupDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    /* 配置写不进去不该影响使用 */
  }
  return next;
}

/** 备份目录：配置里有就用配置的，否则用默认 */
function backupDir() {
  const cfg = readConfig();
  const dir = cfg.backupDir || defaultBackupDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 建不出来就退回默认 */
    try {
      fs.mkdirSync(defaultBackupDir(), { recursive: true });
    } catch {
      /* ignore */
    }
    return defaultBackupDir();
  }
  return dir;
}

let mainWindow = null;

function createWindow() {
  const cfg = readConfig();
  const bounds = cfg.bounds || {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 1200,
    height: bounds.height || 820,
    x: bounds.x,
    y: bounds.y,
    // 需求：最小约 1000x700
    minWidth: 1000,
    minHeight: 700,
    title: '人情账',
    backgroundColor: '#f7f5f0',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // 安全基线：渲染进程不直接碰 Node
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 应用完全离线，禁用不必要的网络能力
      webSecurity: true,
      spellcheck: false,
    },
  });

  // 记住窗口大小与位置
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
    writeConfig({ bounds: mainWindow.getNormalBounds() });
  };
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);
  mainWindow.on('close', saveBounds);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  /**
   * 外部链接一律交给系统浏览器，不在应用内开新窗口。
   * 本应用没有任何外链，这条是防御性的。
   */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 禁止导航到外部地址（防误点）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const ok = isDev ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!ok) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ------------------------------------------------------------------ 菜单 */

function buildMenu() {
  // 精简菜单：只保留必要的，避免一堆用不上的开发者项
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开数据文件夹',
          click: () => shell.openPath(app.getPath('userData')),
        },
        {
          label: '打开备份文件夹',
          click: () => shell.openPath(backupDir()),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];

  // 开发时才给开发者工具
  if (isDev) {
    template.push({
      label: '开发',
      submenu: [{ role: 'toggleDevTools', label: '开发者工具' }],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ IPC */

function registerIpc() {
  /** 路径信息，给设置页显示「数据在哪」 */
  ipcMain.handle('paths', () => ({
    userData: app.getPath('userData'),
    backups: backupDir(),
    ledgerFile: path.join(app.getPath('userData'), 'ledger-snapshot.json'),
  }));

  /** 另存为对话框 + 写文件 */
  ipcMain.handle('save-file', async (_e, { filename, text, mime }) => {
    const ext = path.extname(filename).replace(/^\./, '') || 'json';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '保存到…',
      defaultPath: path.join(app.getPath('documents'), filename),
      filters: [
        { name: ext === 'csv' ? '表格文件' : 'JSON 文件', extensions: [ext] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      await fsp.writeFile(filePath, text, 'utf8');
      void mime;
      return { ok: true, where: `已保存到 ${filePath}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '写入失败' };
    }
  });

  /** 另存为对话框 + 写二进制（PDF） */
  ipcMain.handle('save-binary', async (_e, { filename, data, mime }) => {
    const ext = path.extname(filename).replace(/^\./, '') || 'pdf';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '保存到…',
      defaultPath: path.join(app.getPath('documents'), filename),
      filters: [{ name: 'PDF 文件', extensions: [ext] }],
    });

    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      await fsp.writeFile(filePath, Buffer.from(data));
      void mime;
      return { ok: true, where: `已保存到 ${filePath}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '写入失败' };
    }
  });

  /** 打开文件对话框读文本 */
  ipcMain.handle('open-text-file', async (_e, opts) => {
    const accept = opts?.accept ?? ['.json'];
    const exts = accept
      .map((a) => String(a).replace(/^\./, '').replace(/^.*\//, ''))
      .filter((a) => a && a !== '*');

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      properties: ['openFile'],
      filters: [
        { name: '备份文件', extensions: exts.length ? exts : ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (canceled || !filePaths?.[0]) return null;

    try {
      const text = await fsp.readFile(filePaths[0], 'utf8');
      return { name: path.basename(filePaths[0]), text };
    } catch {
      return null;
    }
  });

  /** 选目录（改备份位置） */
  ipcMain.handle('pick-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件夹',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: backupDir(),
    });
    if (canceled || !filePaths?.[0]) return null;
    return filePaths[0];
  });

  /** 设置备份目录 */
  ipcMain.handle('set-backup-dir', async (_e, dir) => {
    try {
      await fsp.mkdir(dir, { recursive: true });
      writeConfig({ backupDir: dir });
      return { ok: true, dir };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '目录不可用' };
    }
  });

  /** 在文件管理器里打开路径 */
  ipcMain.handle('open-path', async (_e, target) => {
    const r = await shell.openPath(target);
    return r ? { ok: false, error: r } : { ok: true };
  });

  /** 版本号 */
  ipcMain.handle('version', () => app.getVersion());
}

/* ------------------------------------------------------------------ 生命周期 */

// 单实例：重复启动就聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 启动时就把目录建好，避免设置页显示一个不存在的路径
    backupDir();
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // Windows 上关窗即退出
  if (process.platform !== 'darwin') app.quit();
});
