import { beforeEach, describe, expect, it } from 'vitest';
import type { KeyValueStore, SafeStorageLike } from '../services/secretStore/secretStore.js';
import { NoteSessionStore } from './session.js';

function fakeKv(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    delete: (k) => void map.delete(k),
  };
}

// 可逆な擬似暗号（Base64 化のみ）。available / 復号失敗を切替可能。
function fakeSafe(opts: { available?: boolean; failDecrypt?: boolean } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => {
      if (opts.failDecrypt) throw new Error('decrypt failed');
      const s = b.toString('utf8');
      return s.startsWith('enc:') ? s.slice(4) : s;
    },
  };
}

const COOKIES = { _note_session_v5: 'sess', note_gql_auth_token: 'gql' };

describe('NoteSessionStore', () => {
  let kv: ReturnType<typeof fakeKv>;
  beforeEach(() => {
    kv = fakeKv();
  });

  it('保存→取得で Cookie と urlname が復元される', () => {
    const s = new NoteSessionStore(kv, fakeSafe());
    expect(s.save(COOKIES, 'bungo_ai_nosuke')).toEqual({ ok: true });
    expect(s.getCookies()).toEqual(COOKIES);
    expect(s.getUrlname()).toBe('bungo_ai_nosuke');
    expect(s.loginState()).toBe('logged_in');
    expect(s.has()).toBe(true);
  });

  it('平文をディスクに書かない（暗号文が保存される）', () => {
    const s = new NoteSessionStore(kv, fakeSafe());
    s.save(COOKIES, null);
    const raw = kv.map.get('note.session') ?? '';
    expect(raw).not.toContain('sess');
    expect(Buffer.from(raw, 'base64').toString('utf8')).toContain('enc:');
  });

  it('未保存は needs_relogin / null', () => {
    const s = new NoteSessionStore(kv, fakeSafe());
    expect(s.loginState()).toBe('needs_relogin');
    expect(s.getCookies()).toBeNull();
    expect(s.has()).toBe(false);
  });

  it('暗号化不可なら保存はブロックされる', () => {
    const s = new NoteSessionStore(kv, fakeSafe({ available: false }));
    expect(s.save(COOKIES, null)).toEqual({ ok: false, reason: 'encryption_unavailable' });
    expect(s.has()).toBe(false);
  });

  it('復号失敗は needs_relogin（cookies=null）', () => {
    // 保存は成功する safeStorage で書き、読み出しは失敗する safeStorage で読む
    new NoteSessionStore(kv, fakeSafe()).save(COOKIES, 'u');
    const s = new NoteSessionStore(kv, fakeSafe({ failDecrypt: true }));
    expect(s.getCookies()).toBeNull();
    expect(s.loginState()).toBe('needs_relogin');
    expect(s.has()).toBe(true); // 暗号文は存在する
  });

  it('clear / markNeedsRelogin で失効する', () => {
    const s = new NoteSessionStore(kv, fakeSafe());
    s.save(COOKIES, 'u');
    s.markNeedsRelogin();
    expect(s.loginState()).toBe('needs_relogin');
    s.save(COOKIES, 'u');
    s.clear();
    expect(s.has()).toBe(false);
  });
});
