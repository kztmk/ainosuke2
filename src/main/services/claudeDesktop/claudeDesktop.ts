/**
 * claudeDesktop — Claude Desktop の config パス解決・本体検出・再起動（§4.3 / §5.2.2 / §11.5）。
 *
 * OS 依存をすべて注入（platform / env / homedir / pathExists / process）して TDD 可能にする。
 * 再起動は副作用なので決定ロジックのみここに置き、実 quit/launch は ProcessController に委ねる。
 * 再起動前の確認ダイアログは renderer 側の責務（§5.2.2）。
 */
import path from 'node:path';

export interface ProcessController {
  quit(): Promise<void>;
  launch(): Promise<void>;
}

export interface ClaudeDesktopDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  pathExists: (p: string) => boolean;
  process: ProcessController;
}

export class ClaudeDesktopService {
  constructor(private readonly deps: ClaudeDesktopDeps) {}

  /** OS 別の claude_desktop_config.json パス（§4.3）。 */
  resolveConfigPath(): string {
    const { platform, env, homedir } = this.deps;
    if (platform === 'win32') {
      const appData = env.APPDATA ?? path.win32.join(homedir, 'AppData', 'Roaming');
      return path.win32.join(appData, 'Claude', 'claude_desktop_config.json');
    }
    if (platform === 'darwin') {
      return path.posix.join(
        homedir,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      );
    }
    // 非対応 OS（呼び出し側で弾く想定）
    return path.posix.join(homedir, '.config', 'Claude', 'claude_desktop_config.json');
  }

  /** Claude Desktop 本体のインストール候補パス。 */
  candidateAppPaths(): string[] {
    const { platform, env, homedir } = this.deps;
    if (platform === 'win32') {
      const localAppData = env.LOCALAPPDATA ?? path.win32.join(homedir, 'AppData', 'Local');
      return [path.win32.join(localAppData, 'Programs', 'Claude', 'Claude.exe')];
    }
    if (platform === 'darwin') {
      return [
        '/Applications/Claude.app',
        path.posix.join(homedir, 'Applications', 'Claude.app'),
      ];
    }
    return [];
  }

  /** 本体が検出できるか（§5.2.1: 未検出でも保存・接続はブロックしない＝警告用）。 */
  detect(): boolean {
    return this.candidateAppPaths().some((p) => this.deps.pathExists(p));
  }

  /** 再起動（§5.2.2）。確認は呼び出し前に renderer 側で済ませる前提。quit → launch の順。 */
  async restart(): Promise<void> {
    await this.deps.process.quit();
    await this.deps.process.launch();
  }
}
