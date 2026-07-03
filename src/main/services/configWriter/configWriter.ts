/**
 * configWriter — claude_desktop_config.json の安全な読み書き。
 *
 * 設計根拠: 仕様 v1.2 §5.2.1 / ADR-0001（サイト識別キー戦略）/ ADR-0005（平文クリーンアップ）。
 * このファイルは他アプリ所有の設定ファイルを操作するため、最優先で堅牢に保つ。
 * 振る舞いは configWriter.test.ts のゴールデンテストで固定する。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** 自社エントリ識別用の env キー（ADR-0001: エントリ直下ではなく env 内に置く） */
export const MANAGER_ID_ENV = 'WP_MCP_MANAGER_ID';
/** ピン留め対象パッケージ（バージョンは完全固定で渡す。未決#3） */
export const REMOTE_PACKAGE = '@automattic/mcp-wordpress-remote';

export interface SiteConnectionInput {
  /** 内部 uuid。env.WP_MCP_MANAGER_ID に書き、自社エントリ識別に使う */
  managerId: string;
  /** mcpServers のキーに使う表示名（一意・トリム済みであること） */
  displayName: string;
  /** WP_API_URL = サイト URL + mcpEndpoint で組み立て済みの値 */
  apiUrl: string;
  username: string;
  /** 平文のアプリケーションパスワード（secretStore で復号した値を渡す） */
  applicationPassword: string;
  /** 完全固定のバージョン文字列（例: "0.3.5"）。`^`/`~` は付けない */
  pinnedVersion: string;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** note 投稿先の接続入力（ADR-0008 D: bridge エントリ。note 認証情報は載せない）。 */
export interface NoteConnectionInput {
  /** 内部 uuid。env.WP_MCP_MANAGER_ID に書き、自社エントリ識別に使う（WordPress と共通） */
  managerId: string;
  /** mcpServers のキーに使う表示名（一意・トリム済み） */
  displayName: string;
  /** 同梱 note-bridge.mjs の絶対パス */
  bridgePath: string;
  /** アプリ常駐ホストの localhost URL（毎起動で変わりうる） */
  bridgeUrl: string;
  /** Bearer ローカルアクセストークン（localhost 限定・回転可・非アカウント） */
  bridgeToken: string;
  /** bridge を起動する node 実行ファイル（既定 'node'）。実機ではアプリ同梱 Electron を推奨。 */
  nodePath?: string;
  /**
   * bridge に渡す追加 env（例: `ELECTRON_RUN_AS_NODE: '1'`）。
   * Claude Desktop は GUI アプリで PATH が限定的なため、同梱 Electron を node として使う場合に指定する。
   */
  extraEnv?: Record<string, string>;
}

export const NOTE_BRIDGE_URL_ENV = 'NOTE_BRIDGE_URL';
export const NOTE_BRIDGE_TOKEN_ENV = 'NOTE_BRIDGE_TOKEN';

export interface ClaudeConfig {
  mcpServers?: Record<string, McpServerEntry>;
  /** 他アプリが書いたトップレベルキーを保持するための index signature */
  [key: string]: unknown;
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: 'parse_error' | 'key_collision'; message: string };

type ReadResult =
  | { kind: 'ok'; config: ClaudeConfig }
  | { kind: 'missing' }
  | { kind: 'corrupt' };

function buildEntry(input: SiteConnectionInput): McpServerEntry {
  return {
    command: 'npx',
    args: ['-y', `${REMOTE_PACKAGE}@${input.pinnedVersion}`],
    env: {
      WP_API_URL: input.apiUrl,
      WP_API_USERNAME: input.username,
      WP_API_PASSWORD: input.applicationPassword,
      OAUTH_ENABLED: 'false',
      [MANAGER_ID_ENV]: input.managerId,
    },
  };
}

/** note bridge エントリを組み立て（config には localhost URL＋Bearer トークンのみ・秘密は載せない）。 */
function buildNoteEntry(input: NoteConnectionInput): McpServerEntry {
  return {
    command: input.nodePath ?? 'node',
    args: [input.bridgePath],
    env: {
      ...input.extraEnv,
      [NOTE_BRIDGE_URL_ENV]: input.bridgeUrl,
      [NOTE_BRIDGE_TOKEN_ENV]: input.bridgeToken,
      [MANAGER_ID_ENV]: input.managerId,
    },
  };
}

/** env.WP_MCP_MANAGER_ID が一致する既存キーを返す（無ければ undefined） */
function findOwnedKey(config: ClaudeConfig, managerId: string): string | undefined {
  const servers = config.mcpServers ?? {};
  for (const [key, entry] of Object.entries(servers)) {
    if (entry?.env?.[MANAGER_ID_ENV] === managerId) return key;
  }
  return undefined;
}

export class ConfigWriter {
  constructor(private readonly configPath: string) {}

  /**
   * 接続（トグル ON）: エントリを追加。表示名が変わっていれば改名（旧キー削除＋新キー追加）も担う。
   * 同一 managerId への再実行は冪等な更新。
   */
  async connect(input: SiteConnectionInput): Promise<WriteResult> {
    return this.upsertEntry(input.managerId, input.displayName, buildEntry(input));
  }

  /**
   * note 投稿先の接続（bridge エントリを書く・ADR-0008 D）。URL/token は毎起動で変わりうるため、
   * 起動時の再接続でも同一 managerId への冪等な更新になる。
   */
  async connectNote(input: NoteConnectionInput): Promise<WriteResult> {
    return this.upsertEntry(input.managerId, input.displayName, buildNoteEntry(input));
  }

  /** connect / connectNote 共通: 衝突チェック＋改名（旧キー削除）＋エントリ書込。 */
  private async upsertEntry(
    managerId: string,
    displayName: string,
    entry: McpServerEntry,
  ): Promise<WriteResult> {
    const read = await this.readConfig();
    if (read.kind === 'corrupt') return this.corrupt();

    const config: ClaudeConfig = read.kind === 'ok' ? read.config : { mcpServers: {} };
    config.mcpServers ??= {};

    const targetKey = displayName;
    const existing = config.mcpServers[targetKey];
    // 衝突: 対象キーが既に存在し、それが自社（同一 managerId）でない → ブロック
    if (existing && existing.env?.[MANAGER_ID_ENV] !== managerId) {
      return {
        ok: false,
        reason: 'key_collision',
        message: `mcpServers のキー "${targetKey}" は既に他のエントリで使われています。表示名を変更してください。`,
      };
    }

    // 自社エントリが別キーに存在（改名）→ 旧キーを削除
    const ownedKey = findOwnedKey(config, managerId);
    if (ownedKey && ownedKey !== targetKey) delete config.mcpServers[ownedKey];

    config.mcpServers[targetKey] = entry;
    await this.atomicWrite(config);
    return { ok: true };
  }

  /** 接続中サイトの編集。改名も含めて connect と同じ経路で処理する。 */
  async updateConnected(input: SiteConnectionInput): Promise<WriteResult> {
    return this.connect(input);
  }

  /** 接続解除（トグル OFF）: env.WP_MCP_MANAGER_ID で自社エントリを特定して削除。 */
  async disconnect(managerId: string): Promise<WriteResult> {
    const read = await this.readConfig();
    if (read.kind === 'corrupt') return this.corrupt();
    if (read.kind === 'missing') return { ok: true };

    const config = read.config;
    const key = findOwnedKey(config, managerId);
    if (!key) return { ok: true };

    delete config.mcpServers![key];
    await this.atomicWrite(config);
    return { ok: true };
  }

  /** アンインストール準備 / フック（ADR-0005）: 自社エントリを全削除。他アプリ設定は保持。 */
  async removeAllOwned(): Promise<WriteResult> {
    const read = await this.readConfig();
    if (read.kind === 'corrupt') return this.corrupt();
    if (read.kind === 'missing') return { ok: true };

    const config = read.config;
    const servers = config.mcpServers ?? {};
    let changed = false;
    for (const [key, entry] of Object.entries(servers)) {
      if (entry?.env?.[MANAGER_ID_ENV]) {
        delete servers[key];
        changed = true;
      }
    }
    if (changed) await this.atomicWrite(config);
    return { ok: true };
  }

  private corrupt(): WriteResult {
    return {
      ok: false,
      reason: 'parse_error',
      message:
        '既存の claude_desktop_config.json を解析できませんでした。他の MCP 設定の破壊を防ぐため書き込みを中断しました。',
    };
  }

  private async readConfig(): Promise<ReadResult> {
    let raw: string;
    try {
      raw = await fs.readFile(this.configPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'corrupt' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'corrupt' };
    }
    return { kind: 'ok', config: parsed as ClaudeConfig };
  }

  /** 一時ファイルへ書く → 既存を .bak に退避 → rename（§5.2.1 アトミック書き込み） */
  private async atomicWrite(config: ClaudeConfig): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });

    const data = JSON.stringify(config, null, 2) + '\n';
    const tmp = path.join(
      dir,
      `.${path.basename(this.configPath)}.tmp-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    await fs.writeFile(tmp, data, 'utf8');

    // 既存ファイルがあれば .bak を1世代保持
    try {
      const current = await fs.readFile(this.configPath);
      await fs.writeFile(`${this.configPath}.bak`, current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    await fs.rename(tmp, this.configPath);
  }
}

/** テスト/呼び出し側の利便用ファクトリ。config パス解決は claudeDesktop が担う。 */
export function createConfigWriter(configPath: string): ConfigWriter {
  return new ConfigWriter(configPath);
}
