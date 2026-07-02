/**
 * note ログインフロー（ADR-0008 D）。BrowserWindow で note にログインし、
 * `/settings/account` の currentUser 読み取りでログイン成立を判定して全 Cookie を得る。
 *
 * Electron 依存はブラウザ抽象（NoteLoginBrowser）に押し込み、フロー本体は純ロジックで
 * テストする（googleAuth と同じ DI 流儀）。実 BrowserWindow 実装は electronLoginBrowser.ts。
 */

export const NOTE_SETTINGS_URL = 'https://note.com/settings/account';
export const NOTE_LOGIN_URL = 'https://note.com/login';

/**
 * `/settings/account` 上で currentUser（urlname）を読む JS。
 * ① DOM の note ID リンク ② __NEXT_DATA__.pageProps.currentUser の順で試す。
 */
export const NOTE_USERINFO_JS = `(() => {
  try {
    const link = document.querySelector('a[href="/settings/account/note_id"]');
    if (link) { const p = link.querySelector('p'); if (p) { const u=(p.textContent||'').trim(); if (u && /^[a-zA-Z0-9_-]+$/.test(u)) return u; } }
    if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
      const pp = window.__NEXT_DATA__.props.pageProps;
      if (pp && pp.currentUser && pp.currentUser.urlname) return String(pp.currentUser.urlname);
    }
  } catch (e) {}
  return '';
})()`;

/** ログインに使う BrowserWindow の最小抽象（Electron 非依存でテストするための seam）。 */
export interface NoteLoginBrowser {
  loadURL(url: string): Promise<void>;
  /** 現在の URL（ログイン中は /login、成功後は別ページへ遷移する）。 */
  currentUrl(): string;
  /** `/settings/account` 上で currentUser を読み、urlname か ''（未ログイン）を返す。 */
  readUrlname(): Promise<string>;
  /** 全 note.com Cookie（HttpOnly 含む・name→value）。 */
  getCookies(): Promise<Record<string, string>>;
}

export interface NoteLoginDeps {
  browser: NoteLoginBrowser;
  sleep?: (ms: number) => Promise<void>;
  /** ログイン完了待ちのタイムアウト（ms・既定 5 分）。 */
  timeoutMs?: number;
  /** ポーリング間隔（ms・既定 3 秒）。 */
  intervalMs?: number;
}

export type NoteLoginResult =
  | { ok: true; urlname: string; cookies: Record<string, string> }
  | { ok: false; reason: 'timeout' };

/**
 * ログインフロー本体。
 * 1) /settings/account を開く。既ログインなら即 urlname を得る。
 * 2) 未ログインなら /login を開き、ユーザーが窓でログイン（reCAPTCHA も手動）。
 * 3) /login を離れたら /settings/account を開き直して urlname を確認。
 * 4) 取れたら全 Cookie を返す。タイムアウトで失敗。
 */
export async function performNoteLogin(deps: NoteLoginDeps): Promise<NoteLoginResult> {
  const b = deps.browser;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? 5 * 60 * 1000;
  const intervalMs = deps.intervalMs ?? 3000;

  await b.loadURL(NOTE_SETTINGS_URL);
  let urlname = await b.readUrlname();

  if (!urlname) {
    if (!b.currentUrl().includes('/login')) await b.loadURL(NOTE_LOGIN_URL);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(intervalMs);
      const url = b.currentUrl();
      if (url.includes('/login')) continue; // ログイン操作中は邪魔しない
      if (!url.includes('/settings/account')) await b.loadURL(NOTE_SETTINGS_URL);
      urlname = await b.readUrlname();
      if (urlname) break;
    }
  }

  if (!urlname) return { ok: false, reason: 'timeout' };
  const cookies = await b.getCookies();
  return { ok: true, urlname, cookies };
}
