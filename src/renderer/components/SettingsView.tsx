/** 設定画面（§8.3）。 */
import { useTranslation } from 'react-i18next';
import { useApp } from '../state.js';
import { Button, Card, Field, Select, TextInput } from './ui.js';
import type { ThemePref } from '../../shared/domain.js';

export function SettingsView(): JSX.Element {
  const { settings, updateSettings, configPath, openExternal } = useApp();
  const { t } = useTranslation();
  if (!settings) return <div className="p-6 text-sm text-zinc-500">{t('settings.loading')}</div>;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="mb-4 text-lg font-semibold">{t('settings.title')}</h2>
      <Card className="max-w-lg space-y-4 p-5">
        <Field label={t('settings.theme')}>
          <Select
            value={settings.theme}
            onChange={(e) => void updateSettings({ theme: e.target.value as ThemePref })}
          >
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </Select>
        </Field>

        <Field label={t('settings.pollInterval')}>
          <TextInput
            type="number"
            value={settings.pollIntervalMinutes}
            onChange={(e) => void updateSettings({ pollIntervalMinutes: Number(e.target.value) })}
          />
        </Field>

        <Field label={t('settings.logRetention')}>
          <TextInput
            type="number"
            value={settings.logRetentionDays}
            onChange={(e) => void updateSettings({ logRetentionDays: Number(e.target.value) })}
          />
        </Field>

        <Field label={t('settings.warnThreshold')}>
          <TextInput
            type="number"
            value={settings.connectionWarnThresholdHours ?? 0}
            onChange={(e) =>
              void updateSettings({ connectionWarnThresholdHours: Number(e.target.value) || null })
            }
          />
        </Field>

        <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="mb-1 text-xs text-zinc-500">{t('settings.configFile')}</p>
          <p className="mb-2 break-all font-mono text-xs">{configPath}</p>
          <Button onClick={() => openExternal(`file://${configPath}`)}>{t('settings.openFile')}</Button>
        </div>
      </Card>
    </div>
  );
}
