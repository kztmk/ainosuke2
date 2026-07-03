import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Site } from '../shared/domain.js';
import { useApp } from './state.js';
import { Sidebar } from './components/Sidebar.js';
import { SiteDetail } from './components/SiteDetail.js';
import { SiteDialog } from './components/SiteDialog.js';
import { SettingsView } from './components/SettingsView.js';
import { LogView } from './components/LogView.js';
import { TemplatesView } from './components/TemplatesView.js';
import { NoteAccount } from './components/NoteAccount.js';
import { Button, Modal } from './components/ui.js';

type DialogState = { mode: 'add' } | { mode: 'edit'; site: Site } | null;

export function App(): JSX.Element {
  const { view, selected, noteSelected, reloadNote, claudeDetected, toast, showToast, alert, showAlert } = useApp();
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <div className="flex h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar onAdd={() => setDialog({ mode: 'add' })} />

      <main className="flex flex-1 flex-col overflow-hidden">
        {claudeDetected === false && (
          <div className="bg-amber-100 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {t('banner.claudeNotFound')}
          </div>
        )}

        {view === 'main' &&
          (noteSelected ? (
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              <h2 className="text-lg font-semibold">{t('note.section')}</h2>
              <div className="max-w-lg">
                <NoteAccount onChanged={() => void reloadNote()} />
              </div>
            </div>
          ) : selected ? (
            <SiteDetail site={selected} onEdit={() => setDialog({ mode: 'edit', site: selected })} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              {t('main.emptyHint')}
            </div>
          ))}
        {view === 'templates' && <TemplatesView />}
        {view === 'settings' && <SettingsView />}
        {view === 'log' && <LogView />}
      </main>

      {dialog && (
        <SiteDialog
          editing={dialog.mode === 'edit' ? dialog.site : null}
          onClose={() => setDialog(null)}
        />
      )}

      {alert && (
        <Modal title={t('alert.title')} onClose={() => showAlert(null)}>
          <p className="text-sm">{alert}</p>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={() => showAlert(null)}>
              {t('common.ok')}
            </Button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          <span>{toast.message}</span>
          {toast.action && (
            <Button variant="primary" onClick={toast.action.run}>
              {toast.action.label}
            </Button>
          )}
          <button
            aria-label={t('toast.dismiss')}
            className="text-zinc-400 hover:text-white dark:hover:text-zinc-900"
            onClick={() => showToast(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
