/** 記事テンプレート画面（§12.1・Pro）。CRUD ＋ Claude へ貼り付け用コピー。 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArticleTemplate } from '../../shared/domain.js';
import { Button, Card, Field, Modal, TextInput, Textarea } from './ui.js';

type Editing = { mode: 'add' } | { mode: 'edit'; template: ArticleTemplate } | null;

export function TemplatesView(): JSX.Element {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ArticleTemplate[]>([]);
  const [canManage, setCanManage] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setTemplates(await window.api.templates.list());
  }

  useEffect(() => {
    void reload();
    void window.api.entitlement.can('template.manage').then(setCanManage);
  }, []);

  async function onCopy(tpl: ArticleTemplate): Promise<void> {
    await navigator.clipboard.writeText(tpl.body);
    setCopiedId(tpl.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function onDelete(id: string): Promise<void> {
    await window.api.templates.remove(id);
    await reload();
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('templates.title')}</h2>
        <Button variant="primary" disabled={!canManage} onClick={() => setEditing({ mode: 'add' })}>
          {t('templates.add')}
        </Button>
      </div>

      {!canManage && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {t('templates.proOnly')}
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('templates.empty')}</p>
      ) : (
        <div className="space-y-3">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">{tpl.name}</h3>
                <div className="flex gap-2">
                  <Button onClick={() => void onCopy(tpl)}>
                    {copiedId === tpl.id ? t('templates.copied') : t('templates.copy')}
                  </Button>
                  <Button disabled={!canManage} onClick={() => setEditing({ mode: 'edit', template: tpl })}>
                    {t('templates.edit')}
                  </Button>
                  <Button variant="danger" disabled={!canManage} onClick={() => void onDelete(tpl.id)}>
                    {t('templates.delete')}
                  </Button>
                </div>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {tpl.body}
              </pre>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <TemplateDialog
          editing={editing.mode === 'edit' ? editing.template : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: ArticleTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(editing?.name ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [error, setError] = useState<string | null>(null);

  async function onSave(): Promise<void> {
    if (name.trim().length === 0) {
      setError(t('templates.nameRequired'));
      return;
    }
    if (editing) await window.api.templates.update(editing.id, { name, body });
    else await window.api.templates.create({ name, body });
    onSaved();
  }

  return (
    <Modal title={editing ? t('templates.editTitle') : t('templates.addTitle')} onClose={onClose}>
      <div className="space-y-3">
        <Field label={t('templates.name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t('templates.namePlaceholder')} />
        </Field>
        <Field label={t('templates.body')}>
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('templates.bodyPlaceholder')} />
        </Field>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => void onSave()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
