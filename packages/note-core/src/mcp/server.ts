/**
 * note MCP サーバー生成。buildNoteTools を @modelcontextprotocol/sdk の McpServer に登録する。
 * トランスポート（Streamable HTTP / stdio）は接続側（host.ts / note-bridge）が与える。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NoteClient } from '../client.js';
import { buildNoteTools, type NoteToolDef } from './tools.js';

export const NOTE_MCP_SERVER_INFO = { name: 'note-mcp', version: '0.1.0' } as const;

/** NoteClient を載せた MCP サーバーを生成（v1 の6ツールを登録）。 */
export function createNoteMcpServer(client: NoteClient): McpServer {
  const server = new McpServer(NOTE_MCP_SERVER_INFO);
  for (const tool of buildNoteTools(client)) {
    registerTool(server, tool);
  }
  return server;
}

function registerTool(server: McpServer, tool: NoteToolDef): void {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },
    // handler は Record<string, unknown> を受ける純関数。SDK はスキーマで検証済みの引数を渡す。
    tool.handler as never,
  );
}
