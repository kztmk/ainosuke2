/**
 * note 専用 HTML → markdown 変換（P3 逆変換・get_article 用）。
 * 移植元: drillan/note-mcp（MIT）の note_mcp/utils/html_to_markdown.py。
 * 正規表現ベース（DOM パーサ非依存）。markdownToNoteHtml の逆操作。
 *
 * 既知の非対称（note-mcp 由来・段階的に改善）:
 *   - リスト項目内のインライン装飾（**bold** 等）はタグ除去で失われることがある。
 *   - name/id 付き `<code>` などは素の `<code>` パターンに一致せず装飾が落ちうる。
 *   完全な往復一致は保証しない（本文可読性が目的）。
 */

// ── 正規表現（Python の DOTALL は s フラグ、IGNORECASE は i） ─────────────────
// forward が <code> に name/id を付けるため属性許容（素の <code> だと PRE_ONLY が code タグごと拾ってしまう）。
const CODE_BLOCK = /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
const PRE_ONLY = /<pre[^>]*>(?!<code>)([\s\S]*?)<\/pre>/gi;
const HEADING = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
const PARAGRAPH = /<p[^>]*>([\s\S]*?)<\/p>/gi;
const HR = /<hr[^>]*\/?>/gi;
const BLOCKQUOTE_FIGURE =
  /<figure[^>]*>\s*<blockquote[^>]*>([\s\S]*?)<\/blockquote>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>/gi;
const BR = /<br\s*\/?>/gi;
const FIGCAPTION_LINK = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/i;
const IMAGE_FIGURE =
  /<figure[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>/gi;
const IMAGE_FIGURE_ALT =
  /<figure[^>]*>\s*<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"[^>]*>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>/gi;
const UL = /<ul[^>]*>([\s\S]*?)<\/ul>/i;
const OL = /<ol[^>]*>([\s\S]*?)<\/ol>/i;
const LINK = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const STRONG = /<strong>([\s\S]*?)<\/strong>/gi;
const EM = /<em>([\s\S]*?)<\/em>/gi;
// note-mcp は素の <code> だが、forward が name/id を付けるため属性許容に拡張（往復忠実度の改善）。
// コードブロックは先にプレースホルダ保護済みなので誤爆しない。
const INLINE_CODE = /<code[^>]*>([\s\S]*?)<\/code>/gi;
const STRIKETHROUGH = /<s>([\s\S]*?)<\/s>/gi;
const TOC_ELEMENT = /<[^>]*class="[^"]*TableOfContents[^"]*"[^>]*>[\s\S]*?<\/(?:div|section|nav)>/gi;
const TOC_ELEMENT_SIMPLE = /<[^>]*class="[^"]*TableOfContents[^"]*"[^>]*\/?>/gi;
const TEXT_ALIGN_P = /<p([^>]*style="[^"]*text-align:\s*(center|right|left)[^"]*"[^>]*)>([\s\S]*?)<\/p>/gi;
const UUID_ATTR = /\s(?:name|id)="[a-f0-9-]{36}"/gi;
const ANY_TAG = /<[^>]+>/g;

/** HTML エンティティを復号（Python html.unescape の実用サブセット）。 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X';
      const code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
      return m;
    }
    return NAMED[ent] ?? m;
  });
}

/** コードブロックからフェンス記号を除去。 */
function stripFenceMarkers(code: string): string {
  let c = code;
  if (c.startsWith('```')) {
    const nl = c.indexOf('\n');
    if (nl !== -1) {
      c = c.slice(nl + 1);
    } else {
      let end = 3;
      while (end < c.length && /[a-z0-9]/i.test(c[end] ?? '')) end++;
      c = c.slice(end);
    }
  }
  c = c.replace(/\s+$/, '');
  if (c.endsWith('```')) c = c.slice(0, -3);
  return c.trim();
}

// ── ネスト対応のタグマッチング（li/ul/ol 用） ──────────────────────────────
function findMatchingTags(html: string, tagName: string): Array<{ content: string; start: number; end: number }> {
  const results: Array<{ content: string; start: number; end: number }> = [];
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  let pos = 0;

  while (pos < html.length) {
    const tagStart = html.indexOf(openTag, pos);
    if (tagStart === -1) break;
    const tagEnd = html.indexOf('>', tagStart);
    if (tagEnd === -1) break;

    let depth = 1;
    let searchPos = tagEnd + 1;
    while (depth > 0 && searchPos < html.length) {
      const nextOpen = html.indexOf(openTag, searchPos);
      const nextClose = html.indexOf(closeTag, searchPos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        searchPos = nextOpen + openTag.length;
      } else {
        depth -= 1;
        if (depth === 0) {
          results.push({ content: html.slice(tagEnd + 1, nextClose), start: tagStart, end: nextClose + closeTag.length });
        }
        searchPos = nextClose + closeTag.length;
      }
    }
    pos = searchPos;
  }
  return results;
}

function convertList(htmlContent: string, ordered: boolean, indentLevel: number): string {
  const indent = '  '.repeat(indentLevel);
  const lines: string[] = [];
  let counter = 1;

  for (const { content: li } of findMatchingTags(htmlContent, 'li')) {
    // 最初の <p> のテキスト（ネストリストより前）
    const pMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(li);
    let text: string;
    if (pMatch) {
      text = (pMatch[1] ?? '').trim();
    } else {
      // ネストリストを全除去してからテキストを取り出す（note-mcp の sub=全置換に合わせる）
      text = li.replace(/<ul[^>]*>[\s\S]*?<\/ul>/gi, '').replace(/<ol[^>]*>[\s\S]*?<\/ol>/gi, '').trim();
    }
    text = text.replace(ANY_TAG, '').trim();

    if (text) {
      lines.push(ordered ? `${indent}${counter++}. ${text}` : `${indent}- ${text}`);
    }

    const nestedUl = UL.exec(li);
    const nestedOl = OL.exec(li);
    if (nestedUl) lines.push(convertList(nestedUl[1] ?? '', false, indentLevel + 1).replace(/\s+$/, ''));
    if (nestedOl) lines.push(convertList(nestedOl[1] ?? '', true, indentLevel + 1).replace(/\s+$/, ''));
  }
  return lines.join('\n') + '\n';
}

function convertAllLists(html: string): string {
  let result = html;
  for (let i = 0; i < 100; i++) {
    const ul = findMatchingTags(result, 'ul')[0];
    const ol = findMatchingTags(result, 'ol')[0];
    if (!ul && !ol) break;
    if (ul && (!ol || ul.start < ol.start)) {
      result = result.slice(0, ul.start) + convertList(ul.content, false, 0) + result.slice(ul.end);
    } else if (ol) {
      result = result.slice(0, ol.start) + convertList(ol.content, true, 0) + result.slice(ol.end);
    }
  }
  return result;
}

function convertBlockquoteFigure(content: string, figcaptionRaw: string): string {
  let inner = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1');
  inner = inner.replace(BR, '\n');
  const quoteLines = inner
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `> ${l.trim()}`);

  const figcaption = figcaptionRaw.trim();
  if (figcaption) {
    const link = FIGCAPTION_LINK.exec(figcaption);
    if (link) quoteLines.push(`> — ${link[2]} (${link[1]})`);
    else quoteLines.push(`> — ${figcaption}`);
  }
  return quoteLines.join('\n') + '\n\n';
}

function convertImageFigure(src: string, alt: string, captionRaw: string): string {
  const caption = captionRaw.trim();
  return caption ? `![${alt}](${src} "${caption}")\n\n` : `![${alt}](${src})\n\n`;
}

function convertInlineElements(text: string): string {
  let r = text;
  r = r.replace(LINK, (_m, url: string, t: string) => `[${t.trim()}](${url})`);
  r = r.replace(STRONG, '**$1**');
  r = r.replace(EM, '*$1*');
  r = r.replace(STRIKETHROUGH, '~~$1~~');
  r = r.replace(INLINE_CODE, '`$1`');
  return r;
}

/**
 * note HTML を markdown へ変換。空入力は空文字。
 */
export function noteHtmlToMarkdown(htmlContent: string): string {
  if (!htmlContent || !htmlContent.trim()) return '';

  const codeBlocks: string[] = [];
  const extract = (_m: string, code: string): string => {
    const c = stripFenceMarkers(decodeEntities(code));
    codeBlocks.push(`\`\`\`\n${c}\n\`\`\`\n\n`);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  };

  let result = htmlContent;

  // 1. コードブロック保護
  result = result.replace(CODE_BLOCK, extract);
  result = result.replace(PRE_ONLY, extract);

  // 2. TOC
  result = result.replace(TOC_ELEMENT, '[TOC]\n\n').replace(TOC_ELEMENT_SIMPLE, '[TOC]\n\n');

  // 3. figure（blockquote / image）
  result = result.replace(BLOCKQUOTE_FIGURE, (_m, c: string, fc: string) => convertBlockquoteFigure(c, fc));
  result = result.replace(IMAGE_FIGURE, (_m, src: string, alt: string, cap: string) => convertImageFigure(src, alt, cap));
  result = result.replace(IMAGE_FIGURE_ALT, (_m, alt: string, src: string, cap: string) => convertImageFigure(src, alt, cap));

  // 4. 見出し
  result = result.replace(HEADING, (_m, tag: string, text: string) => `${'#'.repeat(Number(tag[1]))} ${text.trim()}\n\n`);

  // 5. リスト（ネスト対応）
  result = convertAllLists(result);

  // 6. 水平線
  result = result.replace(HR, '\n---\n\n');

  // 7. インライン
  result = convertInlineElements(result);

  // 8. テキスト整列段落（通常段落より先）
  result = result.replace(TEXT_ALIGN_P, (_m, _attrs: string, align: string, content: string) => {
    const c = content.trim();
    const a = align.toLowerCase();
    if (a === 'center') return `->${c}<-\n\n`;
    if (a === 'right') return `->${c}\n\n`;
    if (a === 'left') return `<-${c}\n\n`;
    return `${c}\n\n`;
  });

  // 9. 段落
  result = result.replace(PARAGRAPH, (_m, content: string) => `${content.trim()}\n\n`);

  // クリーンアップ（全タグ除去・実体復号）。コードブロックはプレースホルダのままなので保護される。
  result = result.replace(UUID_ATTR, '');
  result = result.replace(ANY_TAG, '');
  result = decodeEntities(result);
  // コードブロック復元は「全タグ除去・復号の後」（code 内の <tag> を消さない／二重復号しない）。
  codeBlocks.forEach((block, i) => {
    result = result.replace(`__CODE_BLOCK_${i}__`, () => block);
  });
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}
