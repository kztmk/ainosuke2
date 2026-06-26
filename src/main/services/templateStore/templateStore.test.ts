/** templateStore ゴールデンテスト（§12.1）。 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TemplateStore, type TemplateBackend } from './templateStore.js';
import type { ArticleTemplate } from '../../../shared/domain.js';

class MemoryBackend implements TemplateBackend {
  items: ArticleTemplate[] = [];
  read() {
    return [...this.items];
  }
  write(t: ArticleTemplate[]) {
    this.items = [...t];
  }
}

let backend: MemoryBackend;
let seq: number;
let clock: Date;
let store: TemplateStore;

beforeEach(() => {
  backend = new MemoryBackend();
  seq = 0;
  clock = new Date('2026-06-25T00:00:00Z');
  store = new TemplateStore(backend, () => `tpl-${++seq}`, () => clock);
});

describe('create', () => {
  it('id とタイムスタンプを付与し、名前をトリムする', () => {
    const t = store.create({ name: '  ブログ用  ', body: '# {{タイトル}}\n2000字で…' });
    expect(t).toMatchObject({
      id: 'tpl-1',
      name: 'ブログ用',
      body: '# {{タイトル}}\n2000字で…',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    });
    expect(store.list()).toHaveLength(1);
  });
});

describe('update', () => {
  it('既存テンプレートを更新し updatedAt を進める', () => {
    const t = store.create({ name: 'A', body: 'x' });
    clock = new Date('2026-07-01T00:00:00Z');
    const u = store.update(t.id, { name: 'A2', body: 'y' });
    expect(u).toMatchObject({ id: t.id, name: 'A2', body: 'y', updatedAt: '2026-07-01T00:00:00.000Z' });
    expect(u!.createdAt).toBe('2026-06-25T00:00:00.000Z');
  });

  it('存在しない id は null', () => {
    expect(store.update('missing', { name: 'x', body: 'y' })).toBeNull();
  });
});

describe('remove', () => {
  it('該当テンプレートのみ削除する', () => {
    const a = store.create({ name: 'A', body: '1' });
    store.create({ name: 'B', body: '2' });
    store.remove(a.id);
    expect(store.list().map((t) => t.name)).toEqual(['B']);
  });
});
