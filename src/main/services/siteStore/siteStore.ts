/**
 * siteStore — サイト設定（SiteRecord・§6.1）の永続化と CRUD。認証情報は扱わない（secretStore の責務）。
 *
 * 表示名の一意性（§5.1.1）・URL 末尾スラッシュ正規化・order 付与・タイムスタンプ管理を担う。
 * 永続化・id 生成・時計を注入してテスト可能にする。Site DTO への組み立て（hasSecret 等）は
 * IPC ハンドラ側で行い、ここは SiteRecord のみを扱う。
 */
import { DEFAULT_MCP_ENDPOINT, type SiteRecord } from '../../../shared/domain.js';
import type { SiteInput } from '../../../shared/ipc.js';

export interface SiteStoreBackend {
  read(): SiteRecord[];
  write(records: SiteRecord[]): void;
}

export type CreateResult =
  | { ok: true; record: SiteRecord }
  | { ok: false; reason: 'duplicate_name' };

export type UpdateResult =
  | { ok: true; record: SiteRecord }
  | { ok: false; reason: 'duplicate_name' | 'not_found' };

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export class SiteStore {
  constructor(
    private readonly backend: SiteStoreBackend,
    private readonly idFactory: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** order 昇順で返す。 */
  list(): SiteRecord[] {
    return [...this.backend.read()].sort((a, b) => a.order - b.order);
  }

  get(id: string): SiteRecord | undefined {
    return this.backend.read().find((r) => r.id === id);
  }

  create(input: SiteInput): CreateResult {
    const name = input.name.trim();
    const records = this.backend.read();
    if (this.nameTaken(records, name, null)) return { ok: false, reason: 'duplicate_name' };

    const ts = this.now().toISOString();
    const record: SiteRecord = {
      id: this.idFactory(),
      name,
      url: normalizeUrl(input.url),
      authMethod: input.authMethod,
      username: input.username,
      mcpEndpoint: input.mcpEndpoint?.trim() || DEFAULT_MCP_ENDPOINT,
      memo: input.memo ?? '',
      order: records.length,
      enabled: false,
      connectedAt: null,
      secretUpdatedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.backend.write([...records, record]);
    return { ok: true, record };
  }

  update(id: string, input: SiteInput): UpdateResult {
    const records = this.backend.read();
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) return { ok: false, reason: 'not_found' };

    const name = input.name.trim();
    if (this.nameTaken(records, name, id)) return { ok: false, reason: 'duplicate_name' };

    const prev = records[idx]!;
    const record: SiteRecord = {
      ...prev,
      name,
      url: normalizeUrl(input.url),
      authMethod: input.authMethod,
      username: input.username,
      mcpEndpoint: input.mcpEndpoint?.trim() || DEFAULT_MCP_ENDPOINT,
      memo: input.memo ?? '',
      updatedAt: this.now().toISOString(),
    };
    const next = [...records];
    next[idx] = record;
    this.backend.write(next);
    return { ok: true, record };
  }

  remove(id: string): void {
    const records = this.backend.read().filter((r) => r.id !== id);
    this.backend.write(records);
  }

  /** 表示順を orderedIds の並びに合わせて order を 0..n-1 に振り直す。 */
  reorder(orderedIds: string[]): void {
    const records = this.backend.read();
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    const next = records.map((r) => {
      const order = rank.get(r.id);
      return order === undefined ? r : { ...r, order };
    });
    this.backend.write(next);
  }

  /** 接続トグル ON/OFF の永続化（enabled・connectedAt を更新）。 */
  setConnectionState(id: string, enabled: boolean, connectedAt: string | null): SiteRecord | undefined {
    return this.patch(id, { enabled, connectedAt });
  }

  /** アプリパスワード更新時に呼ぶ（90日ローテーション警告の起点・§7）。 */
  markSecretUpdated(id: string): SiteRecord | undefined {
    return this.patch(id, { secretUpdatedAt: this.now().toISOString() });
  }

  private patch(id: string, fields: Partial<SiteRecord>): SiteRecord | undefined {
    const records = this.backend.read();
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    const record: SiteRecord = { ...records[idx]!, ...fields, updatedAt: this.now().toISOString() };
    const next = [...records];
    next[idx] = record;
    this.backend.write(next);
    return record;
  }

  private nameTaken(records: SiteRecord[], name: string, excludeId: string | null): boolean {
    return records.some((r) => r.name === name && r.id !== excludeId);
  }
}
