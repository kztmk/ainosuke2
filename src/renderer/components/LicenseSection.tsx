/** ライセンス（Pro）セクション（§12.2）。状態表示・アカウント連携・端末管理・手動トークン（フォールバック）。 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_DEVICES, type LicenseStatus } from '../../shared/domain.js';
import { LICENSE_CHANGED_EVENT } from '../firebase/licenseSync.js';
import { formatDateTime } from '../i18n/index.js';
import { LicenseAccount } from './LicenseAccount.js';
import { Button, Card, Field, TextInput } from './ui.js';

export function LicenseSection(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [s, d] = await Promise.all([window.api.license.status(), window.api.license.deviceId()]);
    setStatus(s);
    setDeviceId(d);
  }, []);

  useEffect(() => {
    void reload();
    // バックグラウンド自動更新が走ったら status を取り直す
    const onChanged = (): void => void reload();
    window.addEventListener(LICENSE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LICENSE_CHANGED_EVENT, onChanged);
  }, [reload]);

  async function onActivate(): Promise<void> {
    setError(null);
    const res = await window.api.license.activate(token.trim());
    if (!res.ok) {
      setError(t('license.activateError', { reason: res.reason }));
      return;
    }
    setToken('');
    await reload();
  }

  async function onDeactivate(): Promise<void> {
    await window.api.license.deactivate();
    await reload();
  }

  if (!status) return <></>;

  const statusLabel = {
    none: t('license.statusFree'),
    valid: t('license.statusPro'),
    grace: t('license.statusGrace'),
    expired: t('license.statusExpired'),
    invalid: t('license.statusInvalid'),
  }[status.reason];

  const isPro = status.tier === 'pro';

  return (
    <Card className="max-w-lg space-y-3 p-5">
      <h3 className="text-sm font-semibold">{t('license.section')}</h3>

      <div className="text-sm">
        <p className={isPro ? 'font-medium text-green-600 dark:text-green-400' : 'text-zinc-600 dark:text-zinc-400'}>
          {statusLabel}
        </p>
        {status.expiresAt && (
          <p className="text-xs text-zinc-500">{t('license.expiresAt', { date: formatDateTime(status.expiresAt) })}</p>
        )}
      </div>

      <p className="break-all text-xs text-zinc-400">{t('license.deviceId', { id: deviceId })}</p>
      <p className="text-xs text-zinc-400">{t('license.deviceLimit', { max: MAX_DEVICES })}</p>

      {status.activated && (
        <Button variant="danger" onClick={() => void onDeactivate()}>
          {t('license.deactivate')}
        </Button>
      )}

      {/* アカウント連携（サインイン → 決済 → 自動有効化 → 端末管理） */}
      <LicenseAccount isPro={isPro} deviceId={deviceId} onActivated={reload} />

      {/* フォールバック: 手動トークン投入 */}
      {!isPro && (
        <details className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <summary className="cursor-pointer text-xs text-zinc-500">{t('license.manualToggle')}</summary>
          <div className="mt-2 space-y-2">
            <Field label={t('license.tokenLabel')}>
              <TextInput value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('license.tokenPlaceholder')} />
            </Field>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <Button onClick={() => void onActivate()} disabled={token.trim().length === 0}>
              {t('license.activate')}
            </Button>
          </div>
        </details>
      )}
    </Card>
  );
}
