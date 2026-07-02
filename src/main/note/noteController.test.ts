import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../services/secretStore/secretStore.js';
import { NoteController } from './noteController.js';
import type { NoteService } from './noteService.js';

function fakeKv(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k), set: (k, v) => void map.set(k, v), delete: (k) => void map.delete(k) };
}

function fakeService(over: Partial<Record<keyof NoteService, unknown>> = {}) {
  return {
    loginState: vi.fn(() => 'logged_in'),
    getUrlname: vi.fn(() => 'bungo_ai_nosuke'),
    isHostRunning: vi.fn(() => false),
    login: vi.fn(async () => ({ ok: true, urlname: 'bungo_ai_nosuke' })),
    logout: vi.fn(async () => {}),
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => ({ ok: true })),
    ...over,
  } as unknown as NoteService;
}

function build(over: Partial<Record<keyof NoteService, unknown>> = {}) {
  const kv = fakeKv();
  const service = fakeService(over);
  let n = 0;
  const controller = new NoteController({ service, kv, idFactory: () => `mgr-${++n}` });
  return { controller, kv, service };
}

describe('NoteController', () => {
  it('status は service とフラグを合成する', () => {
    const { controller, kv } = build({ isHostRunning: vi.fn(() => true) });
    kv.set('note.connected', '1');
    expect(controller.status()).toEqual({
      loginState: 'logged_in',
      urlname: 'bungo_ai_nosuke',
      hostRunning: true,
      connected: true,
    });
  });

  it('login 成功で urlname を返す', async () => {
    const { controller } = build();
    expect(await controller.login()).toEqual({ ok: true, urlname: 'bungo_ai_nosuke' });
  });

  it('connect は managerId と displayName を渡し、connected=1 にする', async () => {
    const { controller, service, kv } = build();
    const r = await controller.connect();
    expect(r).toEqual({ ok: true });
    expect(service.connect).toHaveBeenCalledWith({ managerId: 'mgr-1', displayName: 'note: bungo_ai_nosuke' });
    expect(kv.map.get('note.connected')).toBe('1');
    expect(kv.map.get('note.managerId')).toBe('mgr-1');
  });

  it('managerId は一度だけ生成して再利用する', async () => {
    const { controller, kv } = build();
    await controller.connect();
    await controller.disconnect();
    await controller.connect();
    expect(kv.map.get('note.managerId')).toBe('mgr-1'); // 生成は1回だけ
  });

  it('未ログインの connect は needs_login を素通し', async () => {
    const { controller, kv } = build({ connect: vi.fn(async () => ({ ok: false, reason: 'needs_login' })) });
    expect(await controller.connect()).toEqual({ ok: false, reason: 'needs_login' });
    expect(kv.map.get('note.connected')).not.toBe('1');
  });

  it('disconnect は connected=0 にして service.disconnect(managerId) を呼ぶ', async () => {
    const { controller, service, kv } = build();
    await controller.connect();
    await controller.disconnect();
    expect(service.disconnect).toHaveBeenCalledWith('mgr-1');
    expect(kv.map.get('note.connected')).toBe('0');
  });

  it('logout は connected=0 ＋ service.logout(managerId)', async () => {
    const { controller, service, kv } = build();
    await controller.connect();
    await controller.logout();
    expect(service.logout).toHaveBeenCalledWith('mgr-1');
    expect(kv.map.get('note.connected')).toBe('0');
  });

  describe('resumeOnStartup', () => {
    it('ログイン中かつ接続中なら再接続する', async () => {
      const { controller, service, kv } = build();
      kv.set('note.connected', '1');
      await controller.resumeOnStartup();
      expect(service.connect).toHaveBeenCalledTimes(1);
    });

    it('未接続なら何もしない', async () => {
      const { controller, service } = build();
      await controller.resumeOnStartup();
      expect(service.connect).not.toHaveBeenCalled();
    });

    it('未ログインなら何もしない', async () => {
      const { controller, service, kv } = build({ loginState: vi.fn(() => 'needs_relogin') });
      kv.set('note.connected', '1');
      await controller.resumeOnStartup();
      expect(service.connect).not.toHaveBeenCalled();
    });
  });
});
