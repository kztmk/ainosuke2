/**
 * main エントリ — Electron アプリのライフサイクル・BrowserWindow・バックグラウンド監視・トレイ。
 * セキュリティ: contextIsolation 有効・nodeIntegration 無効（§7）。
 */
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildAppService } from './realDeps.js';
import { registerHandlers } from './ipc/registerHandlers.js';
import { StatusMonitor, type IntervalScheduler } from './services/statusMonitor/statusMonitor.js';
import { IPC_EVENT } from '../shared/ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/**
 * アプリアイコン（docs/ainosuke2.png）を読み込む。見つからなければ null。
 * ※ Phase 4 のパッケージング時は resources/ へ移し electron-builder の icon 設定に揃える。
 */
function loadAppIcon(): Electron.NativeImage | null {
  try {
    const p = path.join(app.getAppPath(), 'docs', 'ainosuke2.png');
    if (!existsSync(p)) return null;
    const img = nativeImage.createFromPath(p);
    return img.isEmpty() ? null : img;
  } catch {
    return null;
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    title: 'WP MCP Manager',
    ...(loadAppIcon() ? { icon: loadAppIcon()! } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return win;
}

/** 外部資産なしでトレイ用の塗りつぶし円アイコンを生成（macOS テンプレート画像＝明暗に追従）。 */
function makeTrayIcon(): Electron.NativeImage {
  const size = 22;
  const buf = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2 - 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = (x - center) ** 2 + (y - center) ** 2 <= radius ** 2;
      // BGRA。黒で塗り、内側のみ不透明にする。
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = inside ? 255 : 0;
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  img.setTemplateImage(true);
  return img;
}

/** §5.4.1 システムトレイ常駐。アプリアイコンを優先し、無ければ生成アイコンにフォールバック。 */
function setupTray(win: BrowserWindow): void {
  try {
    const appIcon = loadAppIcon();
    const trayIcon = appIcon ? appIcon.resize({ width: 18, height: 18 }) : makeTrayIcon();
    tray = new Tray(trayIcon);
    tray.setToolTip('WP MCP Manager');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'ウィンドウを表示', click: () => win.show() },
        { type: 'separator' },
        {
          label: '終了',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', () => win.show());
  } catch {
    tray = null;
  }
}

const scheduler: IntervalScheduler = {
  set: (handler, ms) => setInterval(handler, ms),
  clear: (handle) => clearInterval(handle as NodeJS.Timeout),
};

void app.whenReady().then(() => {
  const appIcon = loadAppIcon();
  if (appIcon && process.platform === 'darwin' && app.dock) app.dock.setIcon(appIcon);

  const win = createWindow();
  mainWindow = win;

  const appService = buildAppService((site) => {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENT.siteStatusChanged, site);
  });
  registerHandlers(appService);
  setupTray(win);

  // §5.3.2 / §5.4.1 起動時の疎通確認＋バックグラウンド監視（自動監視は Pro）
  const settings = appService.settingsGet();
  const monitor = new StatusMonitor(async () => {
    await appService.refreshAllStatuses();
  }, scheduler);
  if (settings.checkOnStartup) void monitor.runNow();
  if (appService.entitlementCan('monitor.background')) {
    monitor.start(Math.max(1, settings.pollIntervalMinutes) * 60_000);
  }

  // トレイ常駐時はウィンドウを閉じても隠すだけにする（§5.4.1）
  win.on('close', (e) => {
    if (!isQuitting && tray && appService.settingsGet().trayResident) {
      e.preventDefault();
      win.hide();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    else win.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
