/**
 * realDeps — 本物の Electron / Node 依存を各サービスへ注入して AppService を組み立てる。
 * テストではこのファイルは使わず、フェイクを注入する（appService.test.ts 参照）。
 */
import { app, safeStorage, shell } from 'electron';
import Store from 'electron-store';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ArticleTemplate,
  type LogEntry,
  type Site,
  type SiteRecord,
} from '../shared/domain.js';
import { AppService, type SettingsStore } from './appService/appService.js';
import {
  ClaudeDesktopService,
  type ProcessController,
} from './services/claudeDesktop/claudeDesktop.js';
import { ConfigWriter } from './services/configWriter/configWriter.js';
import { EntitlementService } from './services/entitlement/entitlement.js';
import { LicenseService, type LicenseKv } from './services/license/license.js';
import { Logger, type LogStore } from './services/logger/logger.js';
import { McpClient } from './services/mcpClient/mcpClient.js';
import {
  SecretStore,
  type KeyValueStore,
} from './services/secretStore/secretStore.js';
import {
  SiteStore,
  type SiteStoreBackend,
} from './services/siteStore/siteStore.js';
import {
  TemplateStore,
  type TemplateBackend,
} from './services/templateStore/templateStore.js';
import { WpClient } from './services/wpClient/wpClient.js';
import { NoteSessionStore } from './note/session.js';
import { NoteService } from './note/noteService.js';
import { NoteController } from './note/noteController.js';
import { startNoteHost } from './note/host.js';
import { createNoteLoginBrowser } from './note/electronLoginBrowser.js';

/**
 * ライセンス署名検証用の公開鍵（Ed25519・SPKI/PEM）。
 * dev 発行サーバー（mcp-switchpoint-wp-dev）の鍵。秘密鍵は Secret Manager の LICENSE_PRIVATE_KEY。
 * ※ prod 配布時は mcp-switchpoint-wp-prod の公開鍵に差し替える（dev/prod は別鍵ペア）。
 */
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzpngEDn8q4PH6eKDFUNYA9U805d20BmSKFf6t4H8X9s=
-----END PUBLIC KEY-----`;

function makeProcessController(): ProcessController {
  const run = (cmd: string) =>
    new Promise<void>((resolve) => exec(cmd, () => resolve()));
  return {
    quit: () =>
      run(
        process.platform === 'win32'
          ? 'taskkill /IM Claude.exe /F'
          : `osascript -e 'quit app "Claude"'`,
      ),
    launch: () =>
      run(
        process.platform === 'win32' ? 'start "" "Claude"' : 'open -a "Claude"',
      ),
  };
}

export function buildAppService(
  emitSiteStatus?: (site: Site) => void,
): AppService {
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
    read: () => ({
      ...DEFAULT_SETTINGS,
      ...(store.get('settings', {}) as Partial<AppSettings>),
    }),
    write: (s) => store.set('settings', s),
  };

  const templateBackend: TemplateBackend = {
    read: () => store.get('templates', []) as ArticleTemplate[],
    write: (templates) => store.set('templates', templates),
  };

  const licenseKv: LicenseKv = {
    get: (key) => store.get(key) as string | undefined,
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
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
    entitlement: new EntitlementService({
      tier: 'free',
      enforcementEnabled: false,
    }),
    claude,
    logger: new Logger(logBackend),
    templates: new TemplateStore(templateBackend, () => randomUUID()),
    license: new LicenseService(LICENSE_PUBLIC_KEY, licenseKv, {
      idFactory: () => randomUUID(),
    }),
    settings,
    openExternal: (url) => shell.openExternal(url),
    emitSiteStatus,
  });
}

/**
 * 同梱 note-bridge.mjs の絶対パスを解決する。
 * - dev: ソースの bridge（SDK は node_modules から解決）
 * - packaged: resources 直下に置いた自己完結バンドル（esbuild で SDK を inline・asarUnpack 不要）
 */
function resolveNoteBridgePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'note-bridge.mjs');
  }
  return path.join(app.getAppPath(), 'src', 'main', 'note', 'bridge', 'note-bridge.mjs');
}

/**
 * NoteController を組み立てる（ADR-0008 D）。config は WordPress と同じ claude_desktop_config.json。
 * note セッションは safeStorage 暗号化保存。ホスト起動/ログイン窓は Electron 実装を注入。
 *
 * bridge の起動は「アプリ同梱の Electron を ELECTRON_RUN_AS_NODE=1 で node として使う」。
 * Claude Desktop は GUI アプリで PATH が限定的なため、system の node に依存しない同梱バイナリが堅実。
 */
export function buildNoteController(configPath: string): NoteController {
  const store = new Store();
  const kv: KeyValueStore = {
    get: (key) => store.get(key) as string | undefined,
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
  };

  const service = new NoteService({
    session: new NoteSessionStore(kv, safeStorage),
    configWriter: new ConfigWriter(configPath),
    bridgePath: resolveNoteBridgePath(),
    nodePath: process.execPath, // アプリ同梱 Electron バイナリ
    extraEnv: { ELECTRON_RUN_AS_NODE: '1' }, // Electron を純 node として起動
    startHost: (client) => startNoteHost(client),
    createLoginBrowser: () => createNoteLoginBrowser(),
  });

  return new NoteController({ service, kv, idFactory: () => randomUUID() });
}
