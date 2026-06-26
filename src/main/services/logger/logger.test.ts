/**
 * logger ゴールデンテスト（§5.4.2 基盤）。ストアと時計を注入。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Logger, type LogEntry, type LogStore } from './logger.js';

class MemoryLogStore implements LogStore {
  entries: LogEntry[] = [];
  read() {
    return [...this.entries];
  }
  write(entries: LogEntry[]) {
    this.entries = [...entries];
  }
}

let store: MemoryLogStore;
let clock: Date;
let logger: Logger;

beforeEach(() => {
  store = new MemoryLogStore();
  clock = new Date('2026-06-25T12:00:00Z');
  logger = new Logger(store, () => clock);
});

describe('record', () => {
  it('タイムスタンプ付きで追記する', () => {
    const e = logger.record({ type: 'site.add', siteId: 'id-1', result: 'ok' });
    expect(e.at).toBe('2026-06-25T12:00:00.000Z');
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({ type: 'site.add', siteId: 'id-1', result: 'ok' });
  });
});

describe('list', () => {
  beforeEach(() => {
    clock = new Date('2026-06-25T10:00:00Z');
    logger.record({ type: 'site.add', siteId: 'a' });
    clock = new Date('2026-06-25T11:00:00Z');
    logger.record({ type: 'test', siteId: 'b', result: 'error' });
    clock = new Date('2026-06-25T12:00:00Z');
    logger.record({ type: 'connect', siteId: 'a' });
  });

  it('新しい順で返す', () => {
    const ats = logger.list().map((e) => e.at);
    expect(ats).toEqual([
      '2026-06-25T12:00:00.000Z',
      '2026-06-25T11:00:00.000Z',
      '2026-06-25T10:00:00.000Z',
    ]);
  });

  it('siteId でフィルタする', () => {
    expect(logger.list({ siteId: 'a' })).toHaveLength(2);
  });

  it('type でフィルタする', () => {
    const r = logger.list({ type: 'test' });
    expect(r).toHaveLength(1);
    expect(r[0]!.siteId).toBe('b');
  });
});

describe('prune（保持日数）', () => {
  it('保持日数を超えた古いエントリを削除し、件数を返す', () => {
    clock = new Date('2026-06-10T12:00:00Z');
    logger.record({ type: 'site.add', siteId: 'old' }); // 15 日前
    clock = new Date('2026-06-24T12:00:00Z');
    logger.record({ type: 'connect', siteId: 'recent' }); // 1 日前

    clock = new Date('2026-06-25T12:00:00Z');
    const removed = logger.prune(7); // 7 日保持

    expect(removed).toBe(1);
    expect(logger.list().map((e) => e.siteId)).toEqual(['recent']);
  });

  it('全エントリが保持期間内なら何も削除しない', () => {
    clock = new Date('2026-06-24T12:00:00Z');
    logger.record({ type: 'sync', siteId: 'x' });
    clock = new Date('2026-06-25T12:00:00Z');
    expect(logger.prune(7)).toBe(0);
    expect(logger.list()).toHaveLength(1);
  });
});
