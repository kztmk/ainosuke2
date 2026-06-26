/**
 * サイト追加/編集ダイアログ（§8.2）。
 * - 入力バリデーション（必須・URL 形式・HTTPS 推奨）。
 * - 最小権限・90日ローテーションのインラインヒントを常時表示（§5.1.1）。
 * - 「接続テスト」と「保存」を分離。テスト失敗でも保存可。テスト結果は成功/失敗で明示（§8.2）。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Site } from '../../shared/domain.js';
import type { SiteInput, TestResult } from '../../shared/ipc.js';
import { useApp } from '../state.js';
import { Button, cn, Field, Modal, Select, TextInput } from './ui.js';

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function SiteDialog({ editing, onClose }: { editing: Site | null; onClose: () => void }): JSX.Element {
  const { saveSite, testDraft } = useApp();
  const { t } = useTranslation();

  const [name, setName] = useState(editing?.name ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [username, setUsername] = useState(editing?.username ?? '');
  const [password, setPassword] = useState('');
  const [memo, setMemo] = useState(editing?.memo ?? '');

  const [showErrors, setShowErrors] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = {
    name: name.trim().length === 0 ? t('validation.nameRequired') : null,
    url:
      url.trim().length === 0
        ? t('validation.urlRequired')
        : !isValidHttpUrl(url)
          ? t('validation.urlInvalid')
          : null,
    username: username.trim().length === 0 ? t('validation.usernameRequired') : null,
  };
  const hasErrors = Boolean(errors.name || errors.url || errors.username);
  const httpWarning = isValidHttpUrl(url) && url.trim().startsWith('http://');

  function buildInput(): SiteInput {
    return { name, url, authMethod: 'application_password', username, memo };
  }

  async function onTest(): Promise<void> {
    setShowErrors(true);
    if (hasErrors) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testDraft(buildInput(), password));
    } finally {
      setTesting(false);
    }
  }

  async function onSave(): Promise<void> {
    setShowErrors(true);
    if (hasErrors) return;
    setSaving(true);
    setSaveError(null);
    try {
      const e = await saveSite(buildInput(), password, editing?.id ?? null);
      if (e) setSaveError(e);
      else onClose();
    } finally {
      setSaving(false);
    }
  }

  const fieldErr = (msg: string | null) =>
    showErrors && msg ? <span className="block text-xs text-red-500">{msg}</span> : null;

  const testAllOk = testResult?.rest.ok && testResult.mcp.ok;
  const unknown = t('dialog.unknownError');

  return (
    <Modal title={editing ? t('dialog.editTitle') : t('dialog.addTitle')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Field label={t('dialog.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.namePlaceholder')} />
          </Field>
          {fieldErr(errors.name)}
        </div>

        <div>
          <Field label={t('dialog.url')} hint={httpWarning ? t('dialog.httpWarning') : undefined}>
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('dialog.urlPlaceholder')} />
          </Field>
          {fieldErr(errors.url)}
        </div>

        <Field label={t('dialog.authMethod')}>
          <Select value="application_password" disabled>
            <option value="application_password">{t('detail.applicationPassword')}</option>
            <option value="jwt">{t('dialog.jwtOption')}</option>
          </Select>
        </Field>

        <div>
          <Field label={t('dialog.username')} hint={t('dialog.usernameHint')}>
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('dialog.usernamePlaceholder')}
              autoComplete="off"
            />
          </Field>
          {fieldErr(errors.username)}
        </div>

        <Field label={t('dialog.appPassword')} hint={t('dialog.appPasswordHint')}>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('dialog.appPasswordPlaceholder')}
            autoComplete="new-password"
          />
        </Field>

        <Field label={t('dialog.memo')}>
          <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>

        {testResult && (
          <div
            className={cn(
              'rounded-md border p-2 text-xs',
              testAllOk
                ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950'
                : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950',
            )}
          >
            <p className="mb-1 font-medium">{testAllOk ? t('dialog.testSuccess') : t('dialog.testFailed')}</p>
            <p>
              {t('dialog.restLabel')}:{' '}
              {testResult.rest.ok
                ? t('dialog.restOk', { count: testResult.rest.publishedCount ?? 0 })
                : t('dialog.restFail', { error: testResult.rest.error ?? unknown })}
            </p>
            <p>
              {t('dialog.mcpLabel')}:{' '}
              {testResult.mcp.ok
                ? t('dialog.mcpOk', { version: testResult.mcp.serverVersion ?? t('common.dash') })
                : t('dialog.mcpFail', { error: testResult.mcp.error ?? unknown })}
            </p>
          </div>
        )}

        {saveError && <p className="text-xs text-red-500">{saveError}</p>}

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" onClick={() => void onTest()} disabled={testing}>
            {testing ? t('dialog.testing') : t('dialog.test')}
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => void onSave()} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
