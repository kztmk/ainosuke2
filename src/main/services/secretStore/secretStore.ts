/**
 * secretStore — アプリケーションパスワードの暗号化保存（仕様 v1.2 §6.2 / §7）。
 *
 * 平文は決してディスクに書かない。Electron safeStorage で暗号化し、暗号文を Base64 で
 * 永続化する。safeStorage と永続化層はインターフェースで注入し（Electron 非依存でテスト可能）、
 * 未決#1 の縮退（暗号化不可・復号失敗）の振る舞いをここに集約する。
 */

/** Electron safeStorage のうち本サービスが使う部分集合。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** electron-store 等の最小 KV 抽象。 */
export interface KeyValueStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const SECRET_PREFIX = 'secrets.';
const keyOf = (siteId: string) => `${SECRET_PREFIX}${siteId}`;

export type SetResult =
  | { ok: true }
  | { ok: false; reason: 'encryption_unavailable' };

export type GetResult =
  /** 復号成功。password は main 内でのみ扱い、renderer へ渡さない。 */
  | { status: 'ok'; password: string }
  /** 当該サイトの暗号文が存在しない。 */
  | { status: 'absent' }
  /** OS 暗号化が利用不可（未決#1: 認証依存操作を無効化する合図）。 */
  | { status: 'encryption_unavailable' }
  /** 暗号文はあるが復号に失敗（鍵変更等）。再入力を促す（未決#1 う）。 */
  | { status: 'needs_reentry' };

export class SecretStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  /** OS の暗号化が利用可能か（起動時チェック・縮退バナー判定に使う）。 */
  isAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  /** 当該サイトの暗号文が保存されているか（復号可否は問わない）。 */
  has(siteId: string): boolean {
    return this.store.get(keyOf(siteId)) !== undefined;
  }

  /**
   * 保存。暗号化不可なら平文フォールバックせず保存をブロックする（§7 平文保存禁止）。
   */
  set(siteId: string, applicationPassword: string): SetResult {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return { ok: false, reason: 'encryption_unavailable' };
    }
    const encrypted = this.safeStorage.encryptString(applicationPassword);
    this.store.set(keyOf(siteId), encrypted.toString('base64'));
    return { ok: true };
  }

  /** 取得。縮退条件をステータスで表現し、呼び出し側（接続/テスト）が分岐する。 */
  get(siteId: string): GetResult {
    const raw = this.store.get(keyOf(siteId));
    if (raw === undefined) return { status: 'absent' };
    if (!this.safeStorage.isEncryptionAvailable()) {
      return { status: 'encryption_unavailable' };
    }
    try {
      const password = this.safeStorage.decryptString(Buffer.from(raw, 'base64'));
      return { status: 'ok', password };
    } catch {
      return { status: 'needs_reentry' };
    }
  }

  /** 削除（サイト削除時）。 */
  remove(siteId: string): void {
    this.store.delete(keyOf(siteId));
  }
}
