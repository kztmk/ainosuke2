/**
 * statusMonitor — バックグラウンド疎通確認のスケジューラ（§5.3.2・Pro 機能）。
 * 「何を確認するか」は runAll コールバックに委ね、ここは間隔実行の開始/停止だけを担う。
 * タイマーは注入してテスト可能にする。
 */
export interface IntervalScheduler {
  set(handler: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export class StatusMonitor {
  private handle: unknown = null;

  constructor(
    private readonly runAll: () => Promise<void>,
    private readonly scheduler: IntervalScheduler,
  ) {}

  /** 指定間隔で runAll を回し始める。多重起動しない（再 start で張り替え）。 */
  start(intervalMs: number): void {
    this.stop();
    this.handle = this.scheduler.set(() => {
      void this.runAll();
    }, intervalMs);
  }

  stop(): void {
    if (this.handle !== null) {
      this.scheduler.clear(this.handle);
      this.handle = null;
    }
  }

  isRunning(): boolean {
    return this.handle !== null;
  }

  /** 起動時の即時実行など（§5.4.1 起動時に疎通確認）。 */
  async runNow(): Promise<void> {
    await this.runAll();
  }
}
