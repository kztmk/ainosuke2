/**
 * 左サイドバー（§8.1）: アプリ名・サイト一覧（カラーバッジ・D&D 並べ替え）・追加・設定/ログ導線。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../state.js';
import { cn } from './ui.js';
import type { HealthStatus } from '../../shared/domain.js';

const dot: Record<HealthStatus, string> = {
  ok: 'text-green-500',
  error: 'text-red-500',
  unverified: 'text-amber-500',
};

export function Sidebar({ onAdd }: { onAdd: () => void }): JSX.Element {
  const { sites, selectedId, selectSite, setView, view, reorder, warningsFor, noteStatus, noteSelected, selectNote } =
    useApp();
  const { t } = useTranslation();
  const [dragId, setDragId] = useState<string | null>(null);

  async function onDrop(targetId: string): Promise<void> {
    if (!dragId || dragId === targetId) return;
    const ids = sites.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setDragId(null);
    await reorder(ids);
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold">{t('app.title')}</h1>
        <p className="text-xs text-zinc-500">{t('app.sitesRegistered', { count: sites.length })}</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {sites.map((s) => (
            <li
              key={s.id}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void onDrop(s.id)}
              onClick={() => {
                selectSite(s.id);
                setView('main');
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                view === 'main' && selectedId === s.id
                  ? 'bg-zinc-100 dark:bg-zinc-800'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-900',
              )}
            >
              <span className={dot[s.health]}>●</span>
              <span className="flex-1 truncate">{s.name}</span>
              {warningsFor(s.id).length > 0 && <span title={t('warnings.badge')}>⚠</span>}
              {s.enabled && <span className="text-[10px] text-green-600 dark:text-green-400">{t('sidebar.connected')}</span>}
            </li>
          ))}
        </ul>

        <button
          onClick={onAdd}
          className="mt-2 w-full rounded-md border border-dashed border-zinc-300 px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {t('sidebar.addSite')}
        </button>

        {/* note 投稿先（単一アカウント・ADR-0008 D） */}
        <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-zinc-400">{t('sidebar.otherPlatforms')}</p>
          <button
            onClick={() => {
              selectNote();
              setView('main');
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              view === 'main' && noteSelected ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900',
            )}
          >
            <span className={noteStatus?.loginState === 'logged_in' ? dot.ok : dot.unverified}>●</span>
            <span className="flex-1 truncate text-left">
              {noteStatus?.urlname ? `note: ${noteStatus.urlname}` : t('note.section')}
            </span>
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {t('note.beta')}
            </span>
            {noteStatus?.connected && (
              <span className="text-[10px] text-green-600 dark:text-green-400">{t('sidebar.connected')}</span>
            )}
          </button>
        </div>
      </nav>

      <div className="border-t border-zinc-200 p-2 text-sm dark:border-zinc-800">
        <button
          onClick={() => setView('templates')}
          className={cn('block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900', view === 'templates' && 'bg-zinc-100 dark:bg-zinc-800')}
        >
          {t('nav.templates')}
        </button>
        <button
          onClick={() => setView('settings')}
          className={cn('block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900', view === 'settings' && 'bg-zinc-100 dark:bg-zinc-800')}
        >
          {t('nav.settings')}
        </button>
        <button
          onClick={() => setView('log')}
          className={cn('block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900', view === 'log' && 'bg-zinc-100 dark:bg-zinc-800')}
        >
          {t('nav.log')}
        </button>
      </div>
    </aside>
  );
}
