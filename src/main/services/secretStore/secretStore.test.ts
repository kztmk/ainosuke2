/**
 * secretStore ゴールデンテスト。仕様 v1.2 §6.2 / §7 / 未決#1（縮退）を固定する。
 * Electron 非依存: safeStorage と KV をフェイクで注入する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SecretStore,
  type KeyValueStore,
  type SafeStorageLike,
} from './secretStore.js';

/** メモリ KV。 */
class InMemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  delete(key: string) {
    this.map.delete(key);
  }
}

/**
 * safeStorage のフェイク。
 * - available を切り替えて暗号化不可を再現。
 * - keyId を変えると既存暗号文の復号が失敗（鍵変更を再現）。
 * - 暗号文は不透明 Buffer（plain を JSON に包む）。実 crypto ではないが API 形状は同じ。
 */
class FakeSafeStorage implements SafeStorageLike {
  available = true;
  keyId = 'k1';
  isEncryptionAvailable() {
    return this.available;
  }
  encryptString(plainText: string): Buffer {
    if (!this.available) throw new Error('encryption unavailable');
    return Buffer.from(JSON.stringify({ k: this.keyId, v: plainText }), 'utf8');
  }
  decryptString(encrypted: Buffer): string {
    const obj = JSON.parse(encrypted.toString('utf8')) as { k: string; v: string };
    if (obj.k !== this.keyId) throw new Error('key mismatch');
    return obj.v;
  }
}

let store: InMemoryStore;
let safe: FakeSafeStorage;
let secrets: SecretStore;

const PW = 'abcd efgh ijkl mnop';

beforeEach(() => {
  store = new InMemoryStore();
  safe = new FakeSafeStorage();
  secrets = new SecretStore(store, safe);
});

describe('保存と取得（往復）', () => {
  it('set した値を get で復号して取り出せる', () => {
    expect(secrets.set('id-1', PW)).toEqual({ ok: true });
    expect(secrets.get('id-1')).toEqual({ status: 'ok', password: PW });
  });

  it('永続化されるのは平文ではなく暗号文の Base64', () => {
    secrets.set('id-1', PW);
    const raw = store.get('secrets.id-1')!;
    expect(raw).not.toBe(PW);
    // Base64 としてデコードでき、復号で元に戻る（＝暗号化経路を通っている）
    const buf = Buffer.from(raw, 'base64');
    expect(safe.decryptString(buf)).toBe(PW);
  });

  it('has は暗号文の有無を反映する', () => {
    expect(secrets.has('id-1')).toBe(false);
    secrets.set('id-1', PW);
    expect(secrets.has('id-1')).toBe(true);
  });

  it('remove で削除できる', () => {
    secrets.set('id-1', PW);
    secrets.remove('id-1');
    expect(secrets.has('id-1')).toBe(false);
    expect(secrets.get('id-1')).toEqual({ status: 'absent' });
  });

  it('未保存サイトの get は absent', () => {
    expect(secrets.get('missing')).toEqual({ status: 'absent' });
  });
});

describe('未決#1: 暗号化不可の縮退（平文フォールバックしない）', () => {
  it('暗号化不可なら set をブロックし、ストアに何も書かない', () => {
    safe.available = false;
    const res = secrets.set('id-1', PW);
    expect(res).toEqual({ ok: false, reason: 'encryption_unavailable' });
    expect(store.map.size).toBe(0);
  });

  it('暗号化不可なら get は encryption_unavailable を返す（暗号文があっても復号しない）', () => {
    secrets.set('id-1', PW); // 利用可能なうちに保存
    safe.available = false;
    expect(secrets.get('id-1')).toEqual({ status: 'encryption_unavailable' });
  });

  it('isAvailable が状態を反映する', () => {
    expect(secrets.isAvailable()).toBe(true);
    safe.available = false;
    expect(secrets.isAvailable()).toBe(false);
  });
});

describe('未決#1 う: 復号失敗（鍵変更）は needs_reentry', () => {
  it('保存後に鍵が変わって復号できないと needs_reentry を返す', () => {
    secrets.set('id-1', PW);
    safe.keyId = 'k2'; // OS 鍵が変わった状況
    expect(secrets.get('id-1')).toEqual({ status: 'needs_reentry' });
  });

  it('鍵変更後も has は true（暗号文自体は残っている）', () => {
    secrets.set('id-1', PW);
    safe.keyId = 'k2';
    expect(secrets.has('id-1')).toBe(true);
  });
});
