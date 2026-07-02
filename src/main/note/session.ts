/**
 * NoteSessionStore — note セッション Cookie の暗号化保存とログイン状態（ADR-0008 / CONTEXT.md）。
 *
 * note セッション Cookie は「乗っ取り級」の秘密なので、平文でディスクに書かず Electron safeStorage で
 * 暗号化して保存する（secretStore と同じ縮退方針）。config には一切出さない（bridge エントリのみ）。
 * safeStorage / 永続化層は注入し Electron 非依存でテストする。
 */
import type { NoteLoginState } from '../../shared/domain.js';
import type { KeyValueStore, SafeStorageLike } from '../services/secretStore/secretStore.js';

const SESSION_KEY = 'note.session';

interface StoredSession {
  cookies: Record<string, string>;
  urlname: string | null;
  /** 保存時刻（ISO8601） */
  savedAt: string;
}

export type SaveResult = { ok: true } | { ok: false; reason: 'encryption_unavailable' };

export class NoteSessionStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  /** OS の暗号化が利用可能か。 */
  isAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  /** ログイン成功時: 取得した全 Cookie（HttpOnly 含む）と urlname を暗号化保存。 */
  save(cookies: Record<string, string>, urlname: string | null): SaveResult {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return { ok: false, reason: 'encryption_unavailable' };
    }
    const payload: StoredSession = { cookies, urlname, savedAt: new Date().toISOString() };
    const enc = this.safeStorage.encryptString(JSON.stringify(payload));
    this.store.set(SESSION_KEY, enc.toString('base64'));
    return { ok: true };
  }

  private load(): StoredSession | null {
    const raw = this.store.get(SESSION_KEY);
    if (raw === undefined) return null;
    if (!this.safeStorage.isEncryptionAvailable()) return null;
    try {
      return JSON.parse(this.safeStorage.decryptString(Buffer.from(raw, 'base64'))) as StoredSession;
    } catch {
      return null;
    }
  }

  /** 復号した Cookie マップ（NoteClient の getCookies に渡す）。無い/復号不可なら null。 */
  getCookies(): Record<string, string> | null {
    return this.load()?.cookies ?? null;
  }

  /** 最後に確認した note ID（urlname）。 */
  getUrlname(): string | null {
    return this.load()?.urlname ?? null;
  }

  /** 暗号文が存在するか（復号可否は問わない）。 */
  has(): boolean {
    return this.store.get(SESSION_KEY) !== undefined;
  }

  /** ログアウト / 明示クリア。 */
  clear(): void {
    this.store.delete(SESSION_KEY);
  }

  /** API が 401 等でセッション無効を確定した時に呼ぶ（再ログインを要求する）。 */
  markNeedsRelogin(): void {
    this.store.delete(SESSION_KEY);
  }

  /**
   * ログイン軸の状態（接続=config 軸とは独立・CONTEXT.md）。
   * 暗号文が存在し復号できる＝logged_in、無い/復号不可＝needs_relogin。
   */
  loginState(): NoteLoginState {
    return this.load() !== null ? 'logged_in' : 'needs_relogin';
  }
}
