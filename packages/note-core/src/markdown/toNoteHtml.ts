/**
 * markdown → note 専用 HTML 変換（P3・最難所）。
 * 移植元: drillan/note-mcp（MIT）の note_mcp/utils/markdown_to_html.py。
 * CommonMark ベースは markdown-it（note-mcp と同じ markdown-it 系）。その後 note 固有の
 * 変換を多段で重ねる：画像→figure、li の <p> 包み、blockquote の <br>／figure 化、
 * 全要素への name/id 付与、code block の note 形式化。
 *
 * note は要素に一意な name/id（UUID）を要求する。UUID はランダムなので生成器を注入可能にし、
 * テストは決定的なカウンタを渡す。
 *
 * 未対応（段階的に忠実度を上げる・note-implementation-plan §6/§8）:
 *   [TOC]、テキスト整列(->center<- 等)、株式記法(^1234/$AAPL)、単独URLの埋め込み化(v2)。
 *   これらは現状そのまま（変換されず）通過する。
 */

import MarkdownIt from 'markdown-it';

export interface ToNoteHtmlOptions {
  /** name/id に使う UUID 生成器（既定 crypto.randomUUID）。テストは決定的に注入。 */
  genId?: () => string;
}

// note-mcp は MarkdownIt()（＝commonmark）+ strikethrough 有効。JS 版も合わせる。
const md = new MarkdownIt('commonmark').enable('strikethrough');

function defaultGenId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// <p><img ...></p> → note figure 形式。
const IMG_IN_P =
  /<p>\s*<img\s+src="([^"]+)"\s+alt="([^"]*)"(?:\s+title="([^"]*)")?\s*\/?\s*>\s*<\/p>/gi;

function convertImagesToNoteFormat(html: string, genId: () => string): string {
  return html.replace(IMG_IN_P, (_m, src: string, alt: string, caption?: string) => {
    const id = genId();
    return (
      `<figure name="${id}" id="${id}">` +
      `<img src="${src}" alt="${alt}" width="620" height="457" contenteditable="false" draggable="false">` +
      `<figcaption>${caption ?? ''}</figcaption></figure>`
    );
  });
}

// <li>text</li> → <li><p>text</p></li>（ProseMirror 要件）。既に <p 開始のものは対象外。
const LI_CONTENT = /(<li[^>]*>)(?!<p)([^<]+|(?:(?!<\/li>)[\s\S])*?)(<\/li>)/gi;

function wrapLiContentInP(html: string): string {
  return html.replace(LI_CONTENT, (m, open: string, content: string, close: string) => {
    if (!content || !content.trim()) return m;
    return `${open}<p>${content.trim()}</p>${close}`;
  });
}

// blockquote 内 <p> の改行を <br> に。
const P_IN_BLOCKQUOTE =
  /(<blockquote[^>]*>[\s\S]*?)(<p[^>]*>)([\s\S]*?)(<\/p>)([\s\S]*?<\/blockquote>)/gi;

function convertBlockquoteNewlinesToBr(html: string): string {
  return html.replace(
    P_IN_BLOCKQUOTE,
    (_m, before: string, pOpen: string, content: string, pClose: string, after: string) =>
      `${before}${pOpen}${content.replace(/\n/g, '<br>')}${pClose}${after}`,
  );
}

// 全要素に name/id（UUID）を付与。<li>/<blockquote> は note が付けないので対象外。
const TAG = /<(p|h[1-6]|ul|ol|code|hr|div|span)(\s[^>]*)?>/gi;

function addUuidToElements(html: string, genId: () => string): string {
  return html.replace(TAG, (m, tag: string, attrs?: string) => {
    const a = attrs ?? '';
    if (a.includes('name="')) return m;
    const id = genId();
    return `<${tag} name="${id}" id="${id}"${a}>`;
  });
}

// 引用（em-dash 行）を figcaption へ抽出。"— Source" / "— Source (URL)"。
const CITATION = /(?:^|<br>)(—\s+.+?)(?:<\/p>|$)/i;
const CITATION_URL = /^(.+?)\s+\((\S+)\)\s*$/;

function extractCitation(content: string): [string, string] {
  const m = CITATION.exec(content);
  if (!m) return [content, ''];
  const citationText = (m[1] ?? '').slice(2).trim(); // 先頭 "— " を除去
  if (!citationText) return [content, ''];
  const modified = content.replace(m[0], '</p>');
  const um = CITATION_URL.exec(citationText);
  const figcaption = um ? `<a href="${um[2]}">${(um[1] ?? '').trim()}</a>` : citationText;
  return [modified, figcaption];
}

// blockquote → note figure 形式（<br> 保持のため API が要求）。
const BLOCKQUOTE_FIGURE = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;

function convertBlockquotesToNoteFormat(html: string, genId: () => string): string {
  return html.replace(BLOCKQUOTE_FIGURE, (_m, content: string) => {
    const id = genId();
    const [modified, figcaption] = extractCitation(content);
    return (
      `<figure name="${id}" id="${id}">` +
      `<blockquote>${modified}</blockquote>` +
      `<figcaption>${figcaption}</figcaption></figure>`
    );
  });
}

// code block を note 形式へ。<pre class="codeBlock" name id>、language クラス除去、
// pre 内の改行は保持し、それ以外の HTML の改行は除去。
const PRE = /<pre([^>]*)>([\s\S]*?)<\/pre>/gi;
const LANGUAGE_CLASS = /<code[^>]*class="language-[^"]*"[^>]*>/g;

function convertCodeBlocksToNoteFormat(html: string, genId: () => string): string {
  const preBlocks: string[] = [];
  let result = html.replace(PRE, (_m, _attrs: string, content: string) => {
    const id = genId();
    const body = content.replace(LANGUAGE_CLASS, '<code>');
    preBlocks.push(`<pre name="${id}" id="${id}" class="codeBlock">${body}</pre>`);
    return `__PRE_BLOCK_${preBlocks.length - 1}__`;
  });
  // pre 以外の改行を除去
  result = result.replace(/\n/g, '');
  // pre を復元（block に $ が含まれても解釈されないよう関数置換）
  preBlocks.forEach((block, i) => {
    result = result.replace(`__PRE_BLOCK_${i}__`, () => block);
  });
  return result;
}

/**
 * markdown を note 専用 HTML へ変換。空入力は空文字。
 * @param markdown markdown テキスト
 * @param opts.genId UUID 生成器（テスト用に決定的注入可能）
 */
export function markdownToNoteHtml(markdown: string, opts: ToNoteHtmlOptions = {}): string {
  if (!markdown || !markdown.trim()) return '';
  const genId = opts.genId ?? defaultGenId;

  let result = md.render(markdown);
  result = convertImagesToNoteFormat(result, genId);
  result = wrapLiContentInP(result);
  result = convertBlockquoteNewlinesToBr(result);
  result = addUuidToElements(result, genId);
  result = convertBlockquotesToNoteFormat(result, genId);
  result = convertCodeBlocksToNoteFormat(result, genId);
  return result;
}
