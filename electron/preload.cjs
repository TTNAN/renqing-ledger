/**
 * 人情账 · Electron preload
 *
 * 这是渲染进程与主进程之间唯一的通道。
 * 只暴露前端真正需要的几个方法，不给任何 Node 能力。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('renqingDesktop', {
  platform: 'desktop',

  /** 另存为对话框 + 写文本 */
  saveFile: (options) => ipcRenderer.invoke('save-file', options),

  /** 另存为对话框 + 写二进制 */
  saveBinary: (options) => ipcRenderer.invoke('save-binary', options),

  /** 打开文件对话框读文本 */
  openTextFile: (options) => ipcRenderer.invoke('open-text-file', options),

  /** 数据/备份路径 */
  getPaths: () => ipcRenderer.invoke('paths'),

  /** 改备份目录 */
  setBackupDir: (dir) => ipcRenderer.invoke('set-backup-dir', dir),

  /** 选目录 */
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),

  /** 在文件管理器里打开 */
  openPath: (target) => ipcRenderer.invoke('open-path', target),

  /** 应用版本 */
  getVersion: () => ipcRenderer.invoke('version'),
});
