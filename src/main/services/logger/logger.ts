/**
 * logger — 操作ログ（§5.4.2）。Phase 2 で UI/CSV を載せるが、Phase 1 では記録口と保持期間の
 * 基盤だけ用意する。ストアと時計を注入してテスト可能にする。
 */

import type { LogEntry, LogType } from '../../../shared/domain.js';

// 共有ドメイン型を再エクスポート（呼び出し側/テストの利便）
export type { LogEntry, LogType } from '../../../shared/domain.js';

export interface LogStore {
  read(): LogEntry[];
  write(entries: LogEntry[]): void;
}

export interface LogFilter {
  siteId?: string;
  type?: LogType;
}

export class Logger {
  constructor(
    private readonly store: LogStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 1 件記録して、確定したエントリ（at 付き）を返す。 */
  record(entry: Omit<LogEntry, 'at'>): LogEntry {
    const full: LogEntry = { at: this.now().toISOString(), ...entry };
    const all = this.store.read();
    all.push(full);
    this.store.write(all);
    return full;
  }

  /** 新しい順で返す。フィルタ可。 */
  list(filter: LogFilter = {}): LogEntry[] {
    return this.store
      .read()
      .filter((e) => (filter.siteId ? e.siteId === filter.siteId : true))
      .filter((e) => (filter.type ? e.type === filter.type : true))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** 保持期間（日数）を超えた古いエントリを削除し、削除件数を返す。 */
  prune(retentionDays: number): number {
    const cutoff = this.now().getTime() - retentionDays * 24 * 60 * 60 * 1000;
    const all = this.store.read();
    const kept = all.filter((e) => new Date(e.at).getTime() >= cutoff);
    if (kept.length !== all.length) this.store.write(kept);
    return all.length - kept.length;
  }
}
