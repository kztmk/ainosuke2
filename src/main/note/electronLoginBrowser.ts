/**
 * NoteLoginBrowser の Electron 実装（BrowserWindow）。login.ts の純フローに渡す薄いアダプタ。
 * ここだけが electron に依存する（テストは login.ts の純ロジックで行い、本ファイルは実機のみ）。
 *
 * bot 検知緩和のため Electron トークンを外したクリーン Chrome UA を使う（PoC で有効性を確認済み）。
 * 永続パーティションで「一度ログインしたら再利用」＝reCAPTCHA 連発を避ける。
 */
import { BrowserWindow, session as electronSession } from 'electron';
import { NOTE_USERINFO_JS, type NoteLoginBrowser } from './login.js';

/** note セッション用の永続パーティション。 */
export const NOTE_PARTITION = 'persist:note';

const CLEAN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface ElectronNoteLoginBrowser extends NoteLoginBrowser {
  window: BrowserWindow;
  close(): void;
}

/** ログイン用 BrowserWindow を作り、NoteLoginBrowser として返す。 */
export function createNoteLoginBrowser(
  opts: { partition?: string; userAgent?: string } = {},
): ElectronNoteLoginBrowser {
  const partition = opts.partition ?? NOTE_PARTITION;
  const ua = opts.userAgent ?? CLEAN_UA;
  const ses = electronSession.fromPartition(partition);
  ses.setUserAgent(ua);

  const win = new BrowserWindow({
    width: 480,
    height: 760,
    title: 'note にログイン',
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setUserAgent(ua);

  return {
    window: win,
    loadURL: (url) => win.webContents.loadURL(url).then(() => undefined),
    currentUrl: () => win.webContents.getURL(),
    readUrlname: () => win.webContents.executeJavaScript(NOTE_USERINFO_JS, true) as Promise<string>,
    getCookies: async () => {
      const cookies = await ses.cookies.get({ url: 'https://note.com' });
      const map: Record<string, string> = {};
      for (const c of cookies) map[c.name] = c.value;
      return map;
    },
    close: () => {
      if (!win.isDestroyed()) win.close();
    },
  };
}
