/** license ゴールデンテスト（§12.2）。Ed25519 鍵ペアを生成して署名/検証を回す。 */
import { beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { LicenseService, signLicense, type LicenseKv } from './license.js';
import type { LicenseClaims } from '../../../shared/domain.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const { privateKey: otherPriv } = crypto.generateKeyPairSync('ed25519');

const NOW = Date.parse('2026-06-25T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

class MemoryKv implements LicenseKv {
  m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k);
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
  delete(k: string) {
    this.m.delete(k);
  }
}

function claims(overrides: Partial<LicenseClaims> = {}): LicenseClaims {
  return {
    tier: 'pro',
    userId: 'user-1',
    deviceId: 'device-1',
    iat: Math.floor((NOW - DAY) / 1000),
    exp: Math.floor((NOW + 30 * DAY) / 1000), // 30 日後
    ...overrides,
  };
}

let store: MemoryKv;
let svc: LicenseService;
let now: number;

beforeEach(() => {
  store = new MemoryKv();
  now = NOW;
  svc = new LicenseService(publicKey, store, { now: () => now, idFactory: () => 'dev-fixed' });
});

describe('verify', () => {
  it('正しい署名の有効トークンは ok・expired=false', () => {
    const r = svc.verify(signLicense(privateKey, claims()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expired).toBe(false);
  });

  it('別の鍵で署名されたトークンは invalid_signature', () => {
    const r = svc.verify(signLicense(otherPriv, claims()));
    expect(r).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('壊れたトークンは malformed', () => {
    expect(svc.verify('not-a-token')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('改ざん（payload 書き換え）は検証に失敗する', () => {
    const token = signLicense(privateKey, claims());
    const tampered =
      Buffer.from(JSON.stringify(claims({ userId: 'attacker' })), 'utf8').toString('base64url') +
      '.' +
      token.split('.')[1];
    expect(svc.verify(tampered).ok).toBe(false);
  });
});

describe('activate / deactivate', () => {
  it('有効トークンを activate すると保存され、status が pro になる', () => {
    const r = svc.activate(signLicense(privateKey, claims()));
    expect(r.ok).toBe(true);
    expect(svc.getStatus()).toMatchObject({ tier: 'pro', activated: true, reason: 'valid', userId: 'user-1' });
  });

  it('期限切れトークンの activate は expired で拒否し、保存しない', () => {
    const expired = signLicense(privateKey, claims({ exp: Math.floor((NOW - DAY) / 1000) }));
    expect(svc.activate(expired)).toEqual({ ok: false, reason: 'expired' });
    expect(svc.getStoredToken()).toBeNull();
  });

  it('deactivate で free に戻る', () => {
    svc.activate(signLicense(privateKey, claims()));
    svc.deactivate();
    expect(svc.getStatus()).toMatchObject({ tier: 'free', activated: false, reason: 'none' });
  });
});

describe('オフライン猶予（§12.2）', () => {
  it('期限切れでも猶予（14日）内なら pro（reason=grace）', () => {
    svc.activate(signLicense(privateKey, claims({ exp: Math.floor((NOW + DAY) / 1000) })));
    now = NOW + 10 * DAY; // exp から 9 日後（< 14 日）
    expect(svc.getStatus()).toMatchObject({ tier: 'pro', reason: 'grace' });
  });

  it('猶予を超えたら free（reason=expired）', () => {
    svc.activate(signLicense(privateKey, claims({ exp: Math.floor((NOW + DAY) / 1000) })));
    now = NOW + 20 * DAY; // exp から 19 日後（> 14 日）
    expect(svc.getStatus()).toMatchObject({ tier: 'free', reason: 'expired' });
  });
});

describe('deviceId', () => {
  it('初回生成して以降は同じ値を返す', () => {
    const id = svc.getDeviceId();
    expect(id).toBe('dev-fixed');
    expect(svc.getDeviceId()).toBe(id);
  });
});

describe('未アクティベート / 不正保存', () => {
  it('トークン無しは free・reason=none', () => {
    expect(svc.getStatus()).toMatchObject({ tier: 'free', activated: false, reason: 'none' });
  });

  it('保存トークンが不正なら free・reason=invalid', () => {
    store.set('license.token', 'garbage');
    expect(svc.getStatus()).toMatchObject({ tier: 'free', activated: true, reason: 'invalid' });
  });
});
