/** ログ画面（§8.4）。フィルタリング＋CSV エクスポート（CSV は Pro・§12.1）。 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogEntry, LogType } from '../../shared/domain.js';
import { formatDateTime } from '../i18n/index.js';
import { Button, Card, Select } from './ui.js';

const LOG_TYPES: LogType[] = [
  'site.add',
  'site.edit',
  'site.delete',
  'test',
  'sync',
  'connect',
  'disconnect',
  'config.update',
];

export function LogView(): JSX.Element {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<LogType | ''>('');

  useEffect(() => {
    void window.api.log
      .list(typeFilter ? { type: typeFilter } : undefined)
      .then(setLogs);
  }, [typeFilter]);

  async function onExport(): Promise<void> {
    const csv = await window.api.log.exportCsv(typeFilter ? { type: typeFilter } : undefined);
    if (csv === null) {
      window.alert(t('log.exportProOnly'));
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wp-mcp-manager-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('log.title')}</h2>
        <div className="flex items-center gap-2">
          <Select
            className="w-48"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as LogType | '')}
          >
            <option value="">{t('log.filterAll')}</option>
            {LOG_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {ty}
              </option>
            ))}
          </Select>
          <Button onClick={() => void onExport()}>{t('log.exportCsv')}</Button>
        </div>
      </div>

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
