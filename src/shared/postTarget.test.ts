import { describe, expect, it } from 'vitest';
import type { NoteTarget, Site } from './domain.js';
import {
  isNoteTarget,
  isWordPressTarget,
  siteToWordPressTarget,
  wordPressTargetToSite,
} from './postTarget.js';

const SITE: Site = {
  id: 's1',
  name: 'My Blog',
  url: 'https://example.com',
  authMethod: 'application_password',
  username: 'editor',
  mcpEndpoint: '/wp-json/mcp/mcp-adapter-default-server',
  memo: '',
  order: 0,
  enabled: false,
  connectedAt: null,
  secretUpdatedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  hasSecret: true,
  connection: 'saved',
  health: 'unverified',
  summary: null,
};

const NOTE: NoteTarget = {
  id: 'n1',
  name: 'note: ぶんご',
  platform: 'note',
  order: 1,
  enabled: false,
  connectedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  memo: '',
  urlname: 'bungo_ai_nosuke',
  noteUserId: '999',
  loginState: 'logged_in',
};

describe('siteToWordPressTarget', () => {
  it('Site に platform=wordpress を付けてロスレスに変換する', () => {
    const t = siteToWordPressTarget(SITE);
    expect(t.platform).toBe('wordpress');
    expect(t.url).toBe('https://example.com');
    // 元 Site の全フィールドが保持される
    expect(wordPressTargetToSite(t)).toEqual(SITE);
  });
});

describe('型ガード', () => {
  it('WordPress を判別する', () => {
    const t = siteToWordPressTarget(SITE);
    expect(isWordPressTarget(t)).toBe(true);
    expect(isNoteTarget(t)).toBe(false);
  });

  it('note を判別する', () => {
    expect(isNoteTarget(NOTE)).toBe(true);
    expect(isWordPressTarget(NOTE)).toBe(false);
  });

  it('ガードで絞り込むと note 固有フィールドに型安全にアクセスできる', () => {
    const targets = [siteToWordPressTarget(SITE), NOTE];
    const logins = targets.filter(isNoteTarget).map((n) => n.loginState);
    expect(logins).toEqual(['logged_in']);
  });
});

describe('wordPressTargetToSite', () => {
  it('note を渡すと null', () => {
    expect(wordPressTargetToSite(NOTE)).toBeNull();
  });
});
