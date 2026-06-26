/**
 * realDeps — 本物の Electron / Node 依存を各サービスへ注入して AppService を組み立てる。
 * テストではこのファイルは使わず、フェイクを注入する（appService.test.ts 参照）。
 */
import Store from 'electron-store';
import { safeStorage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { AppService, type SettingsStore } from './appService/appService.js';
import { ConfigWriter } from './services/configWriter/configWriter.js';
import { SiteStore, type SiteStoreBackend } from './services/siteStore/siteStore.js';
import { SecretStore, type KeyValueStore } from './services/secretStore/secretStore.js';
import { WpClient } from './services/wpClient/wpClient.js';
import { McpClient } from './services/mcpClient/mcpClient.js';
import { EntitlementService } from './services/entitlement/entitlement.js';
import { ClaudeDesktopService, type ProcessController } from './services/claudeDesktop/claudeDesktop.js';
import { Logger, type LogStore } from './services/logger/logger.js';
import { DEFAULT_SETTINGS, type AppSettings, type LogEntry, type SiteRecord } from '../shared/domain.js';

function makeProcessController(): ProcessController {
  const run = (cmd: string) =>
    new Promise<void>((resolve) => exec(cmd, () => resolve()));
  return {
    quit: () =>
      run(process.platform === 'win32' ? 'taskkill /IM Claude.exe /F' : `osascript -e 'quit app "Claude"'`),
    launch: () => run(process.platform === 'win32' ? 'start "" "Claude"' : 'open -a "Claude"'),
  };
}

export function buildAppService(): AppService {
  const store = new Store();

  const siteBackend: SiteStoreBackend = {
    read: () => store.get('sites', []) as SiteRecord[],
    write: (records) => store.set('sites', records),
  };

  const secretKv: KeyValueStore = {
    get: (key) => store.get(key) as string | undefined,
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
  };

  const logBackend: LogStore = {
    read: () => store.get('logs', []) as LogEntry[],
    write: (entries) => store.set('logs', entries),
  };

  const settings: SettingsStore = {
    read: () => ({ ...DEFAULT_SETTINGS, ...(store.get('settings', {}) as Partial<AppSettings>) }),
    write: (s) => store.set('settings', s),
  };

  const claude = new ClaudeDesktopService({
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    pathExists: existsSync,
    process: makeProcessController(),
  });

  return new AppService({
    sites: new SiteStore(siteBackend, () => randomUUID()),
    secrets: new SecretStore(secretKv, safeStorage),
    config: new ConfigWriter(claude.resolveConfigPath()),
    wp: new WpClient((input, init) => fetch(input, init)),
    mcp: new McpClient((input, init) => fetch(input, init)),
    entitlement: new EntitlementService({ tier: 'free', enforcementEnabled: false }),
    claude,
    logger: new Logger(logBackend),
    settings,
    openExternal: (url) => shell.openExternal(url),
  });
}
