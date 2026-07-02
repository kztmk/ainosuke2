/**
 * note MCP ホスト — アプリ内で localhost に常駐する Streamable HTTP MCP サーバー（ADR-0008 D）。
 * note セッションはアプリ内（注入された NoteClient）に留まり、config には出ない。
 * Claude が起動する note-bridge（stdio）だけがこの localhost URL＋Bearer ローカルトークンで接続する。
 *
 * Electron 非依存（Node http のみ）＝単体テスト可能。Electron 側は startNoteHost に
 * 「現在の note セッション Cookie を返す NoteClient」を渡すだけ。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createNoteMcpServer, type NoteClient } from '../../../packages/note-core/src/index.js';

export interface NoteHost {
  /** 待受ポート（ランダム） */
  port: number;
  /** Bearer ローカルアクセストークン（config の env に載る・回転可・非アカウント） */
  token: string;
  /** bridge に渡す URL（config の env に載る localhost 限定） */
  url: string;
  close: () => Promise<void>;
}

function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }));
}

function badRequest(res: ServerResponse, message: string): void {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

/**
 * localhost に MCP ホストを起動。
 * @param client 現在の note セッションを持つ NoteClient（Electron 側が注入）
 * @param opts.host 既定 127.0.0.1 / opts.token 既定ランダム
 */
export async function startNoteHost(
  client: NoteClient,
  opts: { host?: string; token?: string } = {},
): Promise<NoteHost> {
  const host = opts.host ?? '127.0.0.1';
  const token = opts.token ?? randomUUID();
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer: Server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      if (!res.headersSent) badRequest(res, `internal: ${(e as Error).message}`);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // localhost + Bearer 認証（トークン不一致は 401）
    if (req.headers['authorization'] !== `Bearer ${token}`) return unauthorized(res);

    const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      // 新規セッションは initialize リクエストでのみ確立
      if (req.method === 'POST' && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            transports.set(sid, transport as StreamableHTTPServerTransport);
          },
        });
        transport.onclose = () => {
          const sid = transport?.sessionId;
          if (sid) transports.delete(sid);
        };
        const server = createNoteMcpServer(client);
        await server.connect(transport);
      } else {
        return badRequest(res, 'No valid session. Send an initialize request first.');
      }
    }

    await transport.handleRequest(req, res, body);
  }

  await new Promise<void>((resolve) => httpServer.listen(0, host, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  return {
    port,
    token,
    url: `http://${host}:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of transports.values()) void t.close();
        transports.clear();
        httpServer.close(() => resolve());
      }),
  };
}
