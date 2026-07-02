import { describe, expect, it, vi } from 'vitest';
import { performNoteLogin, type NoteLoginBrowser } from './login.js';

const COOKIES = { _note_session_v5: 'sess', note_gql_auth_token: 'gql' };

/** スクリプト化した fake ブラウザ。readUrlname は seq を順に返す。 */
function fakeBrowser(opts: {
  urlnames: string[];
  urlAfterLoad?: (url: string) => string;
}): NoteLoginBrowser & { loaded: string[] } {
  const loaded: string[] = [];
  let current = 'https://note.com/';
  let i = 0;
  return {
    loaded,
    loadURL: vi.fn(async (url: string) => {
      loaded.push(url);
      current = opts.urlAfterLoad ? opts.urlAfterLoad(url) : url;
    }),
    currentUrl: () => current,
    readUrlname: vi.fn(async () => opts.urlnames[i++] ?? ''),
    getCookies: vi.fn(async () => COOKIES),
  };
}

const fastSleep = () => Promise.resolve();

describe('performNoteLogin', () => {
  it('既ログイン（初回で urlname 取得）はそのまま Cookie を返す', async () => {
    const b = fakeBrowser({ urlnames: ['bungo_ai_nosuke'] });
    const r = await performNoteLogin({ browser: b, sleep: fastSleep });
    expect(r).toEqual({ ok: true, urlname: 'bungo_ai_nosuke', cookies: COOKIES });
    expect(b.loaded).toEqual(['https://note.com/settings/account']);
  });

  it('未ログイン→/login を開き、ログイン後に /settings 再読込で検出', async () => {
    // currentUrl の返り値を呼び出し順で制御:
    //   #1 if-チェック=/settings（未リダイレクト）→ loadURL(/login)
    //   #2 poll: /login（ログイン操作中）→ continue
    //   #3 poll: note.com トップ（ログイン完了）→ /settings 再読込 → urlname 取得
    const urls = ['https://note.com/settings/account', 'https://note.com/login', 'https://note.com/'];
    let idx = 0;
    const loaded: string[] = [];
    const b: NoteLoginBrowser & { loaded: string[] } = {
      loaded,
      loadURL: vi.fn(async (url: string) => void loaded.push(url)),
      currentUrl: () => urls[Math.min(idx++, urls.length - 1)]!,
      readUrlname: vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce('bungo_ai_nosuke'),
      getCookies: vi.fn(async () => COOKIES),
    };
    const r = await performNoteLogin({ browser: b, sleep: fastSleep, intervalMs: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.urlname).toBe('bungo_ai_nosuke');
    expect(loaded).toContain('https://note.com/login');
    expect(loaded.filter((u) => u.includes('/settings/account')).length).toBeGreaterThanOrEqual(2);
  });

  it('タイムアウトで失敗を返す', async () => {
    const b = fakeBrowser({ urlnames: [''], urlAfterLoad: () => 'https://note.com/login' });
    const r = await performNoteLogin({ browser: b, sleep: fastSleep, timeoutMs: 5, intervalMs: 1 });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
});
