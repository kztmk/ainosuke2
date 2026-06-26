/** ログ画面（§8.4）。Phase 1 は閲覧のみ（CSV エクスポートは Pro・Phase 2）。 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../../shared/domain.js';
import { formatDateTime } from '../i18n/index.js';
import { Card } from './ui.js';

export function LogView(): JSX.Element {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    void window.api.log.list().then(setLogs);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="mb-4 text-lg font-semibold">{t('log.title')}</h2>
      <Card className="overflow-hidden">
        {logs.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">{t('log.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2 font-medium">{t('log.colDate')}</th>
                <th className="px-4 py-2 font-medium">{t('log.colType')}</th>
                <th className="px-4 py-2 font-medium">{t('log.colResult')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i} className="border-b border-zinc-50 dark:border-zinc-900">
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">{formatDateTime(l.at)}</td>
                  <td className="px-4 py-2">{l.type}</td>
                  <td className="px-4 py-2">
                    {l.result === 'error' ? '❌' : l.result === 'ok' ? '✅' : t('common.dash')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
