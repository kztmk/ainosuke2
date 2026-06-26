/**
 * main エントリ — Electron アプリのライフサイクルと BrowserWindow。
 * セキュリティ: contextIsolation 有効・nodeIntegration 無効（§7）。
 */
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAppService } from './realDeps.js';
import { registerHandlers } from './ipc/registerHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    title: 'WP MCP Manager',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // electron-vite: dev では Vite dev server、本番では out/renderer の index.html を読む
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  const appService = buildAppService();
  registerHandlers(appService);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // §5.4.1 トレイ常駐は将来。現状は macOS 慣習に従い、それ以外は終了。
  if (process.platform !== 'darwin') app.quit();
});
