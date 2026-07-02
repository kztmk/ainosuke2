#!/usr/bin/env node
/**
 * note-bridge — Claude Desktop が stdio で起動する極小の中継（ADR-0008 D）。
 * claude_desktop_config.json は stdio 専用なので、Claude はこの bridge を起動し、
 * bridge がアプリ常駐の note MCP ホスト（localhost・Streamable HTTP）へ橋渡しする。
 *
 * config の env に載るのは localhost URL＋Bearer ローカルトークンのみ（note 認証情報は載らない）。
 *
 * env:
 *   NOTE_BRIDGE_URL   例: http://127.0.0.1:53812/mcp
 *   NOTE_BRIDGE_TOKEN Bearer ローカルアクセストークン
 *
 * 実装は transport レベルの透過中継（Claude↔stdio と host↔HTTP の JSONRPC メッセージを素通し）。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.NOTE_BRIDGE_URL;
const token = process.env.NOTE_BRIDGE_TOKEN;
const errlog = (m) => process.stderr.write(`[note-bridge] ${m}\n`);

if (!url || !token) {
  errlog('NOTE_BRIDGE_URL / NOTE_BRIDGE_TOKEN が未設定です。');
  process.exit(1);
}

const stdio = new StdioServerTransport();
const http = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});

// 透過中継: Claude →(stdio)→ http → ホスト、ホスト →(http)→ stdio → Claude
stdio.onmessage = (msg) => {
  http.send(msg).catch((e) => errlog(`send→host 失敗: ${e?.message ?? e}`));
};
http.onmessage = (msg) => {
  stdio.send(msg).catch((e) => errlog(`send→claude 失敗: ${e?.message ?? e}`));
};
stdio.onclose = () => http.close().catch(() => {});
http.onclose = () => stdio.close().catch(() => {});
stdio.onerror = (e) => errlog(`stdio error: ${e?.message ?? e}`);
http.onerror = (e) => errlog(`http error: ${e?.message ?? e}`);

await http.start();
await stdio.start();
errlog(`起動: ${url}`);
