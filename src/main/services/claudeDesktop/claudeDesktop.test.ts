/**
 * claudeDesktop ゴールデンテスト（§4.3 / §5.2.2）。OS 依存を注入。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeDesktopService,
  type ClaudeDesktopDeps,
  type ProcessController,
} from './claudeDesktop.js';

function makeProc(): ProcessController & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    quit: vi.fn(async () => {
      calls.push('quit');
    }),
    launch: vi.fn(async () => {
      calls.push('launch');
    }),
  };
}

function deps(overrides: Partial<ClaudeDesktopDeps> = {}): ClaudeDesktopDeps {
  return {
    platform: 'darwin',
    env: {},
    homedir: '/Users/alice',
    pathExists: () => false,
    process: makeProc(),
    ...overrides,
  };
}

describe('resolveConfigPath', () => {
  it('macOS は ~/Library/Application Support/Claude 配下', () => {
    const s = new ClaudeDesktopService(deps({ platform: 'darwin', homedir: '/Users/alice' }));
    expect(s.resolveConfigPath()).toBe(
      '/Users/alice/Library/Application Support/Claude/claude_desktop_config.json',
    );
  });

  it('Windows は %APPDATA% 配下', () => {
    const s = new ClaudeDesktopService(
      deps({ platform: 'win32', env: { APPDATA: 'C:\\Users\\bob\\AppData\\Roaming' } }),
    );
    expect(s.resolveConfigPath()).toBe(
      'C:\\Users\\bob\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
    );
  });

  it('Windows で APPDATA 未設定なら homedir から組み立てる', () => {
    const s = new ClaudeDesktopService(
      deps({ platform: 'win32', env: {}, homedir: 'C:\\Users\\bob' }),
    );
    expect(s.resolveConfigPath()).toBe(
      'C:\\Users\\bob\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
    );
  });
});

describe('detect', () => {
  it('候補パスのいずれかが存在すれば true', () => {
    const s = new ClaudeDesktopService(
      deps({ platform: 'darwin', pathExists: (p) => p === '/Applications/Claude.app' }),
    );
    expect(s.detect()).toBe(true);
  });

  it('どの候補も無ければ false', () => {
    const s = new ClaudeDesktopService(deps({ pathExists: () => false }));
    expect(s.detect()).toBe(false);
  });
});

describe('restart', () => {
  it('quit → launch の順で呼ぶ', async () => {
    const proc = makeProc();
    const s = new ClaudeDesktopService(deps({ process: proc }));
    await s.restart();
    expect(proc.calls).toEqual(['quit', 'launch']);
  });
});
