/**
 * note HTML → markdown 変換テスト。
 * 直接変換（手書きの note HTML）＋ 往復（markdown→html→markdown）。
 */
import { describe, expect, it } from 'vitest';
import { noteHtmlToMarkdown } from './fromNoteHtml.js';
import { markdownToNoteHtml } from './toNoteHtml.js';

// 決定的な UUID 風 id（[a-f0-9-]{36} に一致＝UUID_ATTR クリーンアップ対象）。
let c = 0;
const genId = () => {
  c += 1;
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(c).padStart(12, '0')}`;
};

describe('noteHtmlToMarkdown — 直接変換', () => {
  it('空入力は空文字', () => {
    expect(noteHtmlToMarkdown('')).toBe('');
    expect(noteHtmlToMarkdown('  \n ')).toBe('');
  });

  it('見出し（name/id を無視してレベル抽出）', () => {
    expect(noteHtmlToMarkdown('<h2 name="x" id="x">タイトル</h2>')).toBe('## タイトル');
    expect(noteHtmlToMarkdown('<h1>A</h1><h3>B</h3>')).toBe('# A\n\n### B');
  });

  it('段落とインライン（太字/斜体/打消/コード/リンク）', () => {
    const html =
      '<p name="p" id="p">前<strong>太字</strong><em>斜体</em><s>打消</s>' +
      '<code name="c" id="c">code</code><a href="https://note.com">L</a>後</p>';
    expect(noteHtmlToMarkdown(html)).toBe('前**太字***斜体*~~打消~~`code`[L](https://note.com)後');
  });

  it('水平線', () => {
    expect(noteHtmlToMarkdown('<p>a</p><hr name="h" id="h" /><p>b</p>')).toBe('a\n\n---\n\nb');
  });

  it('順序なし/順序つきリスト', () => {
    expect(noteHtmlToMarkdown('<ul><li><p>一</p></li><li><p>二</p></li></ul>')).toBe('- 一\n- 二');
    expect(noteHtmlToMarkdown('<ol><li><p>A</p></li><li><p>B</p></li></ol>')).toBe('1. A\n2. B');
  });

  it('ネストしたリスト（2スペースインデント）', () => {
    const html = '<ul><li><p>親</p><ul><li><p>子</p></li></ul></li></ul>';
    expect(noteHtmlToMarkdown(html)).toBe('- 親\n  - 子');
  });

  it('blockquote figure（URL つき citation）', () => {
    const html =
      '<figure name="f" id="f"><blockquote><p name="p" id="p">引用</p></blockquote>' +
      '<figcaption><a href="https://ex.com">著者</a></figcaption></figure>';
    expect(noteHtmlToMarkdown(html)).toBe('> 引用\n> — 著者 (https://ex.com)');
  });

  it('blockquote figure（プレーン citation / citation なし）', () => {
    expect(
      noteHtmlToMarkdown('<figure><blockquote><p>名言</p></blockquote><figcaption>著者</figcaption></figure>'),
    ).toBe('> 名言\n> — 著者');
    expect(
      noteHtmlToMarkdown('<figure><blockquote><p>引用</p></blockquote><figcaption></figcaption></figure>'),
    ).toBe('> 引用');
  });

  it('code block（フェンス化・エンティティ復号）', () => {
    const html = '<pre name="x" id="x" class="codeBlock"><code>a = 1;\nb = &lt;tag&gt; &amp; c;\n</code></pre>';
    expect(noteHtmlToMarkdown(html)).toBe('```\na = 1;\nb = <tag> & c;\n```');
  });

  it('画像 figure（src/alt どちらの順でも・title→caption）', () => {
    const src = 'https://img.example.com/a.png';
    expect(
      noteHtmlToMarkdown(`<figure><img src="${src}" alt="代替"><figcaption>説明</figcaption></figure>`),
    ).toBe('![代替](https://img.example.com/a.png "説明")');
    expect(
      noteHtmlToMarkdown(`<figure><img alt="代替" src="${src}"><figcaption></figcaption></figure>`),
    ).toBe('![代替](https://img.example.com/a.png)');
  });

  it('TOC 要素 → [TOC]', () => {
    expect(noteHtmlToMarkdown('<div class="TableOfContents">目次</div>')).toBe('[TOC]');
  });

  it('テキスト整列段落 → マーカー', () => {
    expect(noteHtmlToMarkdown('<p style="text-align: center">中央</p>')).toBe('->中央<-');
    expect(noteHtmlToMarkdown('<p style="text-align: right">右</p>')).toBe('->右');
    expect(noteHtmlToMarkdown('<p style="text-align: left">左</p>')).toBe('<-左');
  });

  it('残存タグ除去・エンティティ復号', () => {
    expect(noteHtmlToMarkdown('<p><span>текст</span> &amp; &lt;x&gt;</p>')).toBe('текст & <x>');
  });
});

describe('往復（markdown → note HTML → markdown）', () => {
  const cases = [
    '# 見出し\n\n段落**太字**と*斜体*と`コード`と[link](https://note.com)',
    '- 一\n- 二',
    '1. A\n2. B',
    '> 引用文\n> — 著者 (https://example.com)',
    '```\nconst a = 1;\nconsole.log(a);\n```',
    '![代替](https://img.example.com/a.png "説明")',
    'a\n\n---\n\nb',
  ];
  for (const md of cases) {
    it(md.slice(0, 16).replace(/\n/g, '⏎'), () => {
      c = 0;
      const html = markdownToNoteHtml(md, { genId });
      expect(noteHtmlToMarkdown(html)).toBe(md);
    });
  }
});
