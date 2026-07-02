/**
 * postTarget — 投稿先 union（PostTarget）の型ガードとアダプタ。
 * ドメイン型は domain.ts（純粋型）に置き、判別ロジックはここに集約する。
 * Electron / Node 固有 API に依存しない（renderer / main 双方から使える）。
 */

import type { NoteTarget, PostTarget, Site, WordPressTarget } from './domain.js';

/** WordPress 投稿先か。 */
export function isWordPressTarget(t: PostTarget): t is WordPressTarget {
  return t.platform === 'wordpress';
}

/** note 投稿先か。 */
export function isNoteTarget(t: PostTarget): t is NoteTarget {
  return t.platform === 'note';
}

/** 既存の Site DTO を WordPress 投稿先（union メンバー）へ。ロスレス（platform を付けるだけ）。 */
export function siteToWordPressTarget(site: Site): WordPressTarget {
  return { ...site, platform: 'wordpress' };
}

/** union から WordPress の Site DTO を取り出す（note には無いので null）。 */
export function wordPressTargetToSite(t: PostTarget): Site | null {
  if (!isWordPressTarget(t)) return null;
  // platform を落として元の Site DTO 形へ戻す。
  const { platform: _platform, ...site } = t;
  return site;
}
