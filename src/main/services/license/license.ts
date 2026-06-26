/**
 * license — ライセンストークンの検証・状態判定（§12.2）。
 *
 * トークン形式（発行サーバーと共有・ADR-0006）:
 *   token = base64url(JSON(claims)) + "." + base64url(ed25519_signature)
 *   signature = Ed25519( privateKey, utf8( base64url(JSON(claims)) ) )
 * アプリは**公開鍵のみ**を持ち検証する（秘密鍵はサーバー側 = ADR-0003 の例外）。
 *
 * 入手手段（手動投入 / Firebase Auth）は LicenseProvider 抽象で切替。ここは検証コアに専念し、
 * オフライン猶予（再検証できない間も継続）を扱う。
 */
import crypto, { type KeyObject } from 'node:crypto';
import { LICENSE_OFFLINE_GRACE_DAYS, type LicenseClaims, type LicenseStatus } from '../../../shared/domain.js';

export interface LicenseKv {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const TOKEN_KEY = 'license.token';
const DEVICE_KEY = 'license.deviceId';

export type VerifyResult =
  | { ok: true; claims: LicenseClaims; expired: boolean }
  | { ok: false; reason: 'malformed' | 'invalid_signature' };

export type ActivateResult =
  | { ok: true; claims: LicenseClaims }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' };

function isClaims(v: unknown): v is LicenseClaims {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    c['tier'] === 'pro' &&
    typeof c['userId'] === 'string' &&
    typeof c['deviceId'] === 'string' &&
    typeof c['iat'] === 'number' &&
    typeof c['exp'] === 'number'
  );
}

/** 発行サーバーと同一形式でトークンを生成する参照実装（テスト/サーバー設計用）。 */
export function signLicense(privateKey: KeyObject, claims: LicenseClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey);
  return `${payload}.${sig.toString('base64url')}`;
}

export class LicenseService {
  private readonly graceMs: number;

  constructor(
    private readonly publicKey: KeyObject | string,
    private readonly store: LicenseKv,
    private readonly opts: {
      now?: () => number;
      idFactory?: () => string;
      graceDays?: number;
    } = {},
  ) {
    this.graceMs = (opts.graceDays ?? LICENSE_OFFLINE_GRACE_DAYS) * 24 * 60 * 60 * 1000;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** 署名・構造を検証（期限切れは expired フラグで返す）。 */
  verify(token: string): VerifyResult {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
    const [payload, sig] = parts;

    let claims: unknown;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (!isClaims(claims)) return { ok: false, reason: 'malformed' };

    let valid = false;
    try {
      valid = crypto.verify(null, Buffer.from(payload, 'utf8'), this.publicKey, Buffer.from(sig, 'base64url'));
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, reason: 'invalid_signature' };

    return { ok: true, claims, expired: claims.exp * 1000 <= this.now() };
  }

  /** 手動アクティベーション: 検証して有効なら保存。期限切れ/不正は拒否。 */
  activate(token: string): ActivateResult {
    const res = this.verify(token);
    if (!res.ok) return res;
    if (res.expired) return { ok: false, reason: 'expired' };
    this.store.set(TOKEN_KEY, token);
    return { ok: true, claims: res.claims };
  }

  deactivate(): void {
    this.store.delete(TOKEN_KEY);
  }

  getStoredToken(): string | null {
    return this.store.get(TOKEN_KEY) ?? null;
  }

  /** この端末の安定 ID（無ければ生成して保存）。発行サーバーの台数管理に使う。 */
  getDeviceId(): string {
    let id = this.store.get(DEVICE_KEY);
    if (!id) {
      id = this.opts.idFactory ? this.opts.idFactory() : crypto.randomUUID();
      this.store.set(DEVICE_KEY, id);
    }
    return id;
  }

  /** 保存済みトークンから現在のライセンス状態を判定（オフライン猶予込み）。 */
  getStatus(): LicenseStatus {
    const token = this.getStoredToken();
    if (!token) {
      return { tier: 'free', activated: false, reason: 'none', expiresAt: null, userId: null, deviceId: null };
    }
    const res = this.verify(token);
    if (!res.ok) {
      return { tier: 'free', activated: true, reason: 'invalid', expiresAt: null, userId: null, deviceId: null };
    }

    const { claims } = res;
    const expiresAt = new Date(claims.exp * 1000).toISOString();
    const base = { activated: true, expiresAt, userId: claims.userId, deviceId: claims.deviceId };

    if (!res.expired) return { tier: 'pro', reason: 'valid', ...base };
    if (this.now() < claims.exp * 1000 + this.graceMs) return { tier: 'pro', reason: 'grace', ...base };
    return { tier: 'free', reason: 'expired', ...base };
  }

  tier(): LicenseStatus['tier'] {
    return this.getStatus().tier;
  }
}
