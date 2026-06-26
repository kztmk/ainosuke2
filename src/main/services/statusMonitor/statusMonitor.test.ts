/** statusMonitor ゴールデンテスト（§5.3.2）。タイマーを注入。 */
import { describe, expect, it, vi } from 'vitest';
import { StatusMonitor, type IntervalScheduler } from './statusMonitor.js';

function fakeScheduler() {
  let seq = 0;
  const handlers = new Map<number, () => void>();
  const scheduler: IntervalScheduler = {
    set: (handler) => {
      const id = ++seq;
      handlers.set(id, handler);
      return id;
    },
    clear: (handle) => {
      handlers.delete(handle as number);
    },
  };
  return { scheduler, handlers, tick: (id: number) => handlers.get(id)?.() };
}

describe('start / stop', () => {
  it('start で実行登録され、isRunning が true になる', () => {
    const { scheduler, handlers } = fakeScheduler();
    const m = new StatusMonitor(async () => {}, scheduler);
    m.start(1000);
    expect(m.isRunning()).toBe(true);
    expect(handlers.size).toBe(1);
  });

  it('stop で解除され、isRunning が false になる', () => {
    const { scheduler, handlers } = fakeScheduler();
    const m = new StatusMonitor(async () => {}, scheduler);
    m.start(1000);
    m.stop();
    expect(m.isRunning()).toBe(false);
    expect(handlers.size).toBe(0);
  });

  it('多重 start は古いタイマーを張り替える（重複しない）', () => {
    const { scheduler, handlers } = fakeScheduler();
    const m = new StatusMonitor(async () => {}, scheduler);
    m.start(1000);
    m.start(2000);
    expect(handlers.size).toBe(1);
  });
});

describe('実行', () => {
  it('タイマー発火で runAll が呼ばれる', () => {
    const { scheduler, tick } = fakeScheduler();
    const runAll = vi.fn(async () => {});
    const m = new StatusMonitor(runAll, scheduler);
    m.start(1000);
    tick(1);
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('runNow は即時に runAll を呼ぶ', async () => {
    const { scheduler } = fakeScheduler();
    const runAll = vi.fn(async () => {});
    const m = new StatusMonitor(runAll, scheduler);
    await m.runNow();
    expect(runAll).toHaveBeenCalledTimes(1);
  });
});
