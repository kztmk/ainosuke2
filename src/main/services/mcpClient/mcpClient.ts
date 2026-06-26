/**
 * mcpClient — MCP `initialize` ハンドシェイク（仕様 v1.2 §5.3.1 / 未決#4 確定仕様）。
 *
 * MCP エンドポイントにプロキシ非経由で直接 POST し、serverInfo.version を取得する。
 * 応答は JSON / SSE 両対応。protocolVersion はネゴシエーション（新しい順に試し、
 * 失敗時は1段古い既知版へフォールバック）。initialize のみで使い捨て（セッション維持しない）。
 */
import type { BasicAuth, FetchLike } from '../wpClient/wpClient.js';

/** 新しい順。先頭から試し、JSON-RPC エラー応答なら次へフォールバックする。 */
export const DEFAULT_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface InitializeOptions {
  /** WP_API_URL（サイト URL + mcpEndpoint） */
  endpointUrl: string;
  auth: BasicAuth;
  protocolVersions?: readonly string[];
  clientName?: string;
  clientVersion?: string;
}

export type InitializeResult =
  | {
      ok: true;
      serverName: string | null;
      /** 「MCP アダプターバージョン」として表示する値（§5.3.1） */
      serverVersion: string | null;
      protocolVersion: string | null;
    }
  | { ok: false; error: string; status?: number };

interface RpcResponse {
  result?: {
    protocolVersion?: string;
    serverInfo?: { name?: string; version?: string };
    capabilities?: unknown;
  };
  error?: { code: number; message: string };
}

function basicAuthHeader(auth: BasicAuth): string {
  const token = Buffer.from(`${auth.username}:${auth.applicationPassword}`).toString('base64');
  return `Basic ${token}`;
}

/** SSE 本文から data: 行を結合して JSON を取り出す。 */
function extractSsePayload(text: string): string {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('');
  return data;
}

function parsePayload(bodyText: string, contentType: string | null): RpcResponse {
  const isSse = (contentType ?? '').includes('text/event-stream');
  const jsonText = isSse ? extractSsePayload(bodyText) : bodyText;
  return JSON.parse(jsonText) as RpcResponse;
}

export class McpClient {
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  async initialize(opts: InitializeOptions): Promise<InitializeResult> {
    const versions = opts.protocolVersions ?? DEFAULT_PROTOCOL_VERSIONS;
    let lastRpcError: InitializeResult & { ok: false } = {
      ok: false,
      error: 'initialize に失敗しました',
    };

    for (const version of versions) {
      const attempt = await this.attempt(opts, version);
      if (attempt.ok) return attempt;
      // ネットワーク/HTTP エラーは版を変えても無駄なので即時返す。
      // JSON-RPC エラー応答（版非対応の可能性）だけ次の版へフォールバックする。
      if (attempt.kind !== 'rpc_error') return attempt.result;
      lastRpcError = attempt.result;
    }
    return lastRpcError;
  }

  private async attempt(
    opts: InitializeOptions,
    protocolVersion: string,
  ): Promise<
    | { ok: true; serverName: string | null; serverVersion: string | null; protocolVersion: string | null }
    | { ok: false; kind: 'network' | 'http' | 'rpc_error' | 'parse'; result: InitializeResult & { ok: false } }
  > {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: {
          name: opts.clientName ?? 'WP MCP Manager',
          version: opts.clientVersion ?? '0.1.0',
        },
      },
    });

    let res: Response;
    try {
      res = await this.fetchFn(opts.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: basicAuthHeader(opts.auth),
        },
        body,
      });
    } catch (e) {
      return { ok: false, kind: 'network', result: { ok: false, error: (e as Error).message } };
    }

    if (!res.ok) {
      return {
        ok: false,
        kind: 'http',
        result: { ok: false, status: res.status, error: `HTTP ${res.status}` },
      };
    }

    let payload: RpcResponse;
    try {
      const text = await res.text();
      payload = parsePayload(text, res.headers.get('Content-Type'));
    } catch (e) {
      return { ok: false, kind: 'parse', result: { ok: false, error: `応答の解析に失敗: ${(e as Error).message}` } };
    }

    if (payload.error) {
      return {
        ok: false,
        kind: 'rpc_error',
        result: { ok: false, error: payload.error.message },
      };
    }

    const info = payload.result?.serverInfo;
    return {
      ok: true,
      serverName: info?.name ?? null,
      serverVersion: info?.version ?? null,
      protocolVersion: payload.result?.protocolVersion ?? null,
    };
  }
}
