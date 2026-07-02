/**
 * note MCP ツール定義（v1 の中核6ツール）。
 * note-core（NoteClient）をラップし、Claude ↔ note の境界で markdown⇄note HTML 変換を挟む。
 * ハンドラは SDK 非依存の純関数（fake fetch の NoteClient で単体テスト可能）。server.ts が SDK に登録する。
 *
 * ADR-0008 D: ログイン/ログアウトは MCP ツールにしない（アプリ UI で行う）。ツールは記事操作のみ。
 * 移植元: drillan/note-mcp（MIT）の note_mcp/server.py のツール説明・出力メッセージ。
 */
import { z } from 'zod';
import type { NoteClient } from '../client.js';
import { markdownToNoteHtml } from '../markdown/toNoteHtml.js';
import { noteHtmlToMarkdown } from '../markdown/fromNoteHtml.js';
import type { NoteArticleStatus, NoteErrorCode } from '../models.js';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface NoteToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolTextResult>;
}

function ok(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] };
}
function err(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** note-core の失敗結果を日本語メッセージへ。認証切れはアプリ側ログインを促す（D 案）。 */
function failMessage(prefix: string, r: { code?: NoteErrorCode; error: string; status?: number }): string {
  if (r.code === 'not_authenticated' || r.status === 401) {
    return 'セッションが無効です。アプリで note にログインし直してください。';
  }
  if (r.code === 'published_cannot_delete') return '公開済みの記事は削除できません。';
  return `${prefix}: ${r.error}`;
}

function statusLabel(s: NoteArticleStatus): string {
  return s === 'draft' ? '下書き' : '公開済み';
}

/** NoteClient を束ねた v1 ツール定義配列を返す。 */
export function buildNoteTools(client: NoteClient): NoteToolDef[] {
  return [
    {
      name: 'note_create_draft',
      description:
        'note.com に下書き記事を作成します。本文は Markdown 形式で渡すと note 用 HTML に変換して送信します。blockquote 内の引用（— 出典名）は figcaption に自動入力されます。',
      inputSchema: {
        title: z.string().describe('記事のタイトル'),
        body: z.string().describe('記事の本文（Markdown 形式）'),
        tags: z.array(z.string()).optional().describe('記事のタグ（# なしでも可）'),
      },
      handler: async (args) => {
        const title = String(args['title'] ?? '');
        const body = String(args['body'] ?? '');
        const tags = (args['tags'] as string[] | undefined) ?? undefined;
        const r = await client.createDraft({ title, bodyHtml: markdownToNoteHtml(body), tags });
        if (!r.ok) return err(failMessage('記事作成に失敗しました', r));
        const tagInfo = r.value.tags.length ? `、タグ: ${r.value.tags.join(', ')}` : '';
        return ok(`下書きを作成しました。ID: ${r.value.id}、キー: ${r.value.key}${tagInfo}`);
      },
    },
    {
      name: 'note_get_article',
      description:
        '記事の内容（タイトル・本文・ステータス）を取得します。本文は Markdown で返します。編集前に既存内容を確認する用途に使います。キー形式（例: n1234567890ab）を指定してください。',
      inputSchema: {
        article_id: z.string().describe('取得する記事のキー（例: n1234567890ab）'),
      },
      handler: async (args) => {
        const key = String(args['article_id'] ?? '');
        const r = await client.getArticle(key);
        if (!r.ok) return err(failMessage('記事の取得に失敗しました', r));
        const a = r.value;
        const tagInfo = a.tags.length ? `\nタグ: ${a.tags.join(', ')}` : '';
        const md = noteHtmlToMarkdown(a.bodyHtml);
        return ok(`記事を取得しました。\n\nタイトル: ${a.title}\nステータス: ${a.status}${tagInfo}\n\n本文:\n${md}`);
      },
    },
    {
      name: 'note_update_article',
      description:
        '既存の記事を更新します。編集前に note_get_article で既存内容を取得することを推奨します。本文は Markdown 形式で渡すと note 用 HTML に変換します。',
      inputSchema: {
        article_id: z.string().describe('更新する記事の ID またはキー'),
        title: z.string().describe('新しいタイトル'),
        body: z.string().describe('新しい本文（Markdown 形式）'),
        tags: z.array(z.string()).optional().describe('新しいタグ（# なしでも可）'),
      },
      handler: async (args) => {
        const id = String(args['article_id'] ?? '');
        const title = String(args['title'] ?? '');
        const body = String(args['body'] ?? '');
        const tags = (args['tags'] as string[] | undefined) ?? undefined;
        const r = await client.updateDraft(id, { title, bodyHtml: markdownToNoteHtml(body), tags });
        if (!r.ok) return err(failMessage('記事更新に失敗しました', r));
        return ok(`記事を更新しました。ID: ${r.value.id}`);
      },
    },
    {
      name: 'note_publish_article',
      description:
        '記事を公開します。article_id を指定すると既存の下書きを公開します。title/body を指定すると新規に作成して公開します。公開は取り消せません。',
      inputSchema: {
        article_id: z.string().optional().describe('公開する下書き記事のキー（新規作成時は省略）'),
        title: z.string().optional().describe('記事タイトル（新規作成時は必須）'),
        body: z.string().optional().describe('記事本文（Markdown 形式・新規作成時は必須）'),
        tags: z.array(z.string()).optional().describe('記事のタグ（# なしでも可）'),
      },
      handler: async (args) => {
        const articleId = args['article_id'] ? String(args['article_id']) : undefined;
        const title = args['title'] ? String(args['title']) : undefined;
        const body = args['body'] ? String(args['body']) : undefined;
        const tags = (args['tags'] as string[] | undefined) ?? undefined;

        let key = articleId;
        if (!key) {
          if (!title || !body) return err('article_id または（title と body）のいずれかを指定してください。');
          // 新規作成 → 公開
          const created = await client.createDraft({ title, bodyHtml: markdownToNoteHtml(body), tags });
          if (!created.ok) return err(failMessage('記事作成に失敗しました', created));
          key = created.value.key;
        }
        const r = await client.publishArticle(key, tags);
        if (!r.ok) return err(failMessage('記事公開に失敗しました', r));
        const urlInfo = r.value.url ? `、URL: ${r.value.url}` : '';
        return ok(`記事を公開しました。ID: ${r.value.id}${urlInfo}`);
      },
    },
    {
      name: 'note_list_articles',
      description: '自分の記事一覧を取得します。status（draft/published/all）でフィルタできます。',
      inputSchema: {
        status: z.enum(['draft', 'published', 'all']).optional().describe('フィルタするステータス（省略時は all）'),
        page: z.number().int().min(1).optional().describe('ページ番号（1 から）'),
        limit: z.number().int().min(1).max(10).optional().describe('1 ページの件数（最大 10）'),
      },
      handler: async (args) => {
        const status = args['status'] as 'draft' | 'published' | 'all' | undefined;
        const page = (args['page'] as number | undefined) ?? 1;
        const limit = (args['limit'] as number | undefined) ?? 10;
        const r = await client.listArticles({
          page,
          limit,
          status: status && status !== 'all' ? status : undefined,
        });
        if (!r.ok) return err(failMessage('記事一覧の取得に失敗しました', r));
        if (r.articles.length === 0) return ok('記事が見つかりませんでした。');
        const lines = [`記事一覧（${r.total}件中${r.articles.length}件、ページ${r.page}）:`];
        for (const a of r.articles) {
          lines.push(`  - [${statusLabel(a.status)}] ${a.title} (ID: ${a.id}、キー: ${a.key})`);
        }
        if (r.hasMore) lines.push(`  （続きは page=${r.page + 1} で取得できます）`);
        return ok(lines.join('\n'));
      },
    },
    {
      name: 'note_delete_draft',
      description:
        '下書き記事を削除します。公開済みは削除できません。2 段階確認: confirm=false で対象を表示、confirm=true で実行。削除は取り消せません。',
      inputSchema: {
        article_key: z.string().describe('削除する記事のキー（例: n1234567890ab）'),
        confirm: z.boolean().optional().describe('削除を実行する場合は true（既定 false）'),
      },
      handler: async (args) => {
        const key = String(args['article_key'] ?? '');
        const confirm = Boolean(args['confirm'] ?? false);
        const r = await client.deleteDraft(key, { confirm });
        if (!r.ok) return err(failMessage('削除に失敗しました', r));
        if (r.value.kind === 'preview') {
          return ok(
            `削除対象の記事:\n  タイトル: ${r.value.title}\n  キー: ${r.value.articleKey}\n  ステータス: ${r.value.status}\n\n` +
              `削除するには confirm=true を指定して再度実行してください。`,
          );
        }
        return ok(`下書き記事「${r.value.title}」（${r.value.articleKey}）を削除しました。`);
      },
    },
  ];
}
