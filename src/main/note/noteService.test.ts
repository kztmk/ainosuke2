import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore, SafeStorageLike } from '../services/secretStore/secretStore.js';
import { NoteSessionStore } from './session.js';
import { NoteService, type NoteServiceDeps } from './noteService.js';
import type { NoteHost } from './host.js';
import type { NoteLoginBrowser } from './login.js';

function fakeKv(): KeyValueStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k) };
}
const fakeSafe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8'),
  decryptString: (b) => b.toString('utf8'),
};

const COOKIES = { _note_session_v5: 'sess' };

// ログイン成功/失敗を切替できる fake ブラウザ
function loginBrowser(urlname: string): NoteLoginBrowser & { close: () => void; closed: boolean } {
  const b = {
    closed: false,
    loadURL: vi.fn(async () => {}),
    currentUrl: () => 'https://note.com/settings/account',
    readUrlname: vi.fn(async () => urlname),
    getCookies: vi.fn(async () => COOKIES),
    close: vi.fn(() => {
      b.closed = true;
    }),
  };
  return b;
}

function makeHost(): NoteHost & { close: ReturnType<typeof vi.fn> } {
  return { port: 51234, token: 'tok-1', url: 'http://127.0.0.1:51234/mcp', close: vi.fn(async () => {}) };
}

function build(over: Partial<NoteServiceDeps> = {}) {
  const session = new NoteSessionStore(fakeKv(), fakeSafe);
  const connectNote = vi.fn(async () => ({ ok: true }) as const);
  const disconnect = vi.fn(async () => ({ ok: true }) as const);
  const configWriter = { connectNote, disconnect } as unknown as NoteServiceDeps['configWriter'];
  const host = makeHost();
  const startHost = vi.fn(async () => host);
  const browser = loginBrowser('bungo_ai_nosuke');
  const svc = new NoteService({
    session,
    configWriter,
    bridgePath: '/app/note-bridge.mjs',
    startHost,
    createLoginBrowser: () => browser,
    // テストはログイン待ちを即時化
    loginTuning: { timeoutMs: 20, intervalMs: 1, sleep: () => Promise.resolve() },
    ...over,
  });
  return { svc, session, connectNote, disconnect, startHost, host, browser };
}

describe('NoteService', () => {
  it('login 成功でセッションを保存し urlname を返す（窓は閉じる）', async () => {
    const { svc, session, browser } = build();
    const r = await svc.login();
    expect(r).toEqual({ ok: true, urlname: 'bungo_ai_nosuke' });
    expect(session.loginState()).toBe('logged_in');
    expect(session.getCookies()).toEqual(COOKIES);
    expect(browser.closed).toBe(true);
  });

  it('login タイムアウトはセッションを保存しない', async () => {
    const { svc, session } = build({ createLoginBrowser: () => loginBrowser('') });
    const r = await svc.login();
    expect(r.ok).toBe(false);
    expect(session.loginState()).toBe('needs_relogin');
  });

  it('未ログインで connect すると needs_login', async () => {
    const { svc, startHost, connectNote } = build();
    const r = await svc.connect({ managerId: 'm1', displayName: 'note: x' });
    expect(r).toEqual({ ok: false, reason: 'needs_login' });
    expect(startHost).not.toHaveBeenCalled();
    expect(connectNote).not.toHaveBeenCalled();
  });

  it('ログイン後 connect でホスト起動＋bridge エントリ書込（URL/token を反映）', async () => {
    const { svc, startHost, connectNote, host } = build();
    await svc.login();
    const r = await svc.connect({ managerId: 'm1', displayName: 'note: x' });
    expect(r).toEqual({ ok: true });
    expect(startHost).toHaveBeenCalledTimes(1);
    expect(connectNote).toHaveBeenCalledWith(
      expect.objectContaining({
        managerId: 'm1',
        displayName: 'note: x',
        bridgePath: '/app/note-bridge.mjs',
        bridgeUrl: host.url,
        bridgeToken: host.token,
      }),
    );
    expect(svc.isHostRunning()).toBe(true);
  });

  it('connect を繰り返してもホストは1回だけ起動（再利用）', async () => {
    const { svc, startHost } = build();
    await svc.login();
    await svc.connect({ managerId: 'm1', displayName: 'note: x' });
    await svc.connect({ managerId: 'm1', displayName: 'note: x' });
    expect(startHost).toHaveBeenCalledTimes(1);
  });

  it('disconnect で config から外し、ホストを停止する', async () => {
    const { svc, disconnect, host } = build();
    await svc.login();
    await svc.connect({ managerId: 'm1', displayName: 'note: x' });
    await svc.disconnect('m1');
    expect(disconnect).toHaveBeenCalledWith('m1');
    expect(host.close).toHaveBeenCalled();
    expect(svc.isHostRunning()).toBe(false);
  });

  it('logout でセッション破棄＋ホスト停止＋config 解除', async () => {
    const { svc, session, disconnect } = build();
    await svc.login();
    await svc.connect({ managerId: 'm1', displayName: 'note: x' });
    await svc.logout('m1');
    expect(session.loginState()).toBe('needs_relogin');
    expect(disconnect).toHaveBeenCalledWith('m1');
    expect(svc.isHostRunning()).toBe(false);
  });
});
