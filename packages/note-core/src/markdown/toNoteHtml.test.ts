/**
 * markdown → note HTML 変換のゴールデンテスト。
 * UUID は決定的に注入（id1, id2, ...）。期待値は note 専用 HTML の形式に忠実
 * （note-mcp markdown_to_html.py と同じ出力構造）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { markdownToNoteHtml } from './toNoteHtml.js';

let counter = 0;
const genId = () => `id${++counter}`;
beforeEach(() => {
  counter = 0;
});
const conv = (md: string) => markdownToNoteHtml(md, { genId });

describe('markdownToNoteHtml — 基本', () => {
  it('空入力・空白のみは空文字', () => {
    expect(markdownToNoteHtml('')).toBe('');
    expect(markdownToNoteHtml('   \n  ')).toBe('');
  });

  it('見出しと段落に name/id を付け、改行を除去する', () => {
    expect(conv('# 見出し\n\n段落テキストです。')).toBe(
      '<h1 name="id1" id="id1">見出し</h1><p name="id2" id="id2">段落テキストです。</p>',
    );
  });

  it('太字/斜体/打消/インラインコード', () => {
    expect(conv('**太字** *斜体* ~~打消~~ `コード`')).toBe(
      '<p name="id1" id="id1"><strong>太字</strong> <em>斜体</em> <s>打消</s> <code name="id2" id="id2">コード</code></p>',
    );
  });

  it('リンク', () => {
    expect(conv('[note](https://note.com)')).toBe(
      '<p name="id1" id="id1"><a href="https://note.com">note</a></p>',
    );
  });

  it('水平線', () => {
    expect(conv('a\n\n---\n\nb')).toBe(
      '<p name="id1" id="id1">a</p><hr name="id2" id="id2" /><p name="id3" id="id3">b</p>',
    );
  });
});

describe('リスト（li は <p> で包む・li 自体に name は付けない）', () => {
  it('順序なしリスト', () => {
    expect(conv('- 項目1\n- 項目2')).toBe(
      '<ul name="id1" id="id1"><li><p name="id2" id="id2">項目1</p></li><li><p name="id3" id="id3">項目2</p></li></ul>',
    );
  });

  it('順序つきリスト', () => {
    expect(conv('1. 一\n2. 二')).toBe(
      '<ol name="id1" id="id1"><li><p name="id2" id="id2">一</p></li><li><p name="id3" id="id3">二</p></li></ol>',
    );
  });
});

describe('blockquote → figure（引用元 citation 抽出）', () => {
  it('URL つき citation を figcaption のリンクへ', () => {
    expect(conv('> 引用文\n> — 著者 (https://example.com)')).toBe(
      '<figure name="id2" id="id2"><blockquote><p name="id1" id="id1">引用文</p></blockquote>' +
        '<figcaption><a href="https://example.com">著者</a></figcaption></figure>',
    );
  });

  it('URL なし citation はプレーンテキストの figcaption', () => {
    expect(conv('> 名言だ\n> — 著者')).toBe(
      '<figure name="id2" id="id2"><blockquote><p name="id1" id="id1">名言だ</p></blockquote>' +
        '<figcaption>著者</figcaption></figure>',
    );
  });

  it('citation なしの blockquote は空 figcaption', () => {
    expect(conv('> ただの引用')).toBe(
      '<figure name="id2" id="id2"><blockquote><p name="id1" id="id1">ただの引用</p></blockquote>' +
        '<figcaption></figcaption></figure>',
    );
  });
});

describe('code block → note 形式', () => {
  it('language クラスを除去し、pre 内の改行を保持する', () => {
    expect(conv('```js\nconst a = 1;\nconsole.log(a);\n```')).toBe(
      '<pre name="id2" id="id2" class="codeBlock"><code>const a = 1;\nconsole.log(a);\n</code></pre>',
    );
  });

  it('コード内の $ や特殊文字を壊さない', () => {
    const out = conv('```\ncost = $5 & <tag>\n```');
    // HTML エスケープ済みでそのまま保持（$ が置換で消えない）
    expect(out).toContain('cost = $5 &amp; &lt;tag&gt;\n');
    expect(out).toMatch(/^<pre name="id\d" id="id\d" class="codeBlock">/);
  });
});

describe('画像 → note figure', () => {
  it('img を figure(620x457) へ変換し alt/caption を移す', () => {
    expect(conv('![代替](https://img.example.com/a.png)')).toBe(
      '<figure name="id1" id="id1"><img src="https://img.example.com/a.png" alt="代替" ' +
        'width="620" height="457" contenteditable="false" draggable="false"><figcaption></figcaption></figure>',
    );
  });

  it('title があれば figcaption に入れる', () => {
    expect(conv('![代替](https://img.example.com/a.png "説明")')).toContain('<figcaption>説明</figcaption>');
  });
});

describe('構造的性質', () => {
  it('コード外に生の改行を残さない', () => {
    const out = conv('# H\n\n段落1\n\n段落2\n\n- a\n- b');
    expect(out.includes('\n')).toBe(false);
  });

  it('既定の genId は毎回異なる id を返す（crypto.randomUUID）', () => {
    const out = markdownToNoteHtml('# a\n\nb');
    const ids = [...out.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
