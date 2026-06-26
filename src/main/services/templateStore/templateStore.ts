/**
 * templateStore — 記事テンプレート（ArticleTemplate）の永続化と CRUD（§12.1・Pro）。
 * 永続化・id・時計を注入してテスト可能にする。Pro ゲートは呼び出し側（AppService/UI）で適用。
 */
import type { ArticleTemplate } from '../../../shared/domain.js';
import type { TemplateInput } from '../../../shared/ipc.js';

export interface TemplateBackend {
  read(): ArticleTemplate[];
  write(templates: ArticleTemplate[]): void;
}

export class TemplateStore {
  constructor(
    private readonly backend: TemplateBackend,
    private readonly idFactory: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): ArticleTemplate[] {
    return this.backend.read();
  }

  create(input: TemplateInput): ArticleTemplate {
    const ts = this.now().toISOString();
    const template: ArticleTemplate = {
      id: this.idFactory(),
      name: input.name.trim(),
      body: input.body,
      createdAt: ts,
      updatedAt: ts,
    };
    this.backend.write([...this.backend.read(), template]);
    return template;
  }

  update(id: string, input: TemplateInput): ArticleTemplate | null {
    const all = this.backend.read();
    const idx = all.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const updated: ArticleTemplate = {
      ...all[idx]!,
      name: input.name.trim(),
      body: input.body,
      updatedAt: this.now().toISOString(),
    };
    const next = [...all];
    next[idx] = updated;
    this.backend.write(next);
    return updated;
  }

  remove(id: string): void {
    this.backend.write(this.backend.read().filter((t) => t.id !== id));
  }
}
