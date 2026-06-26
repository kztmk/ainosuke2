/**
 * 右メインパネル（§8.1）: サマリー・ボタン列（同期/編集/ブラウザでログイン）・接続設定・接続トグル。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Site } from '../../shared/domain.js';
import { useApp } from '../state.js';
import { formatNumber } from '../i18n/index.js';
import { Button, Card, HealthBadge, Modal, Toggle } from './ui.js';

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <Card className="p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </Card>
  );
}

export function SiteDetail({ site, onEdit }: { site: Site; onEdit: () => void }): JSX.Element {
  const { syncSite, toggleConnection, removeSite, openExternal } = useApp();
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function onSync(): Promise<void> {
    setSyncing(true);
    try {
      await syncSite(site.id);
    } finally {
      setSyncing(false);
    }
  }

  const s = site.summary;
  const dash = t('common.dash');
  const connStateLabel = {
    saved: t('detail.connState.saved'),
    connected_pending_restart: t('detail.connState.pendingRestart'),
    connected_active: t('detail.connState.active'),
  }[site.connection];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{site.name}</h2>
            <HealthBadge health={site.health} />
          </div>
          <p className="text-sm text-zinc-500">{site.url}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void onSync()} disabled={syncing}>
            {syncing ? t('detail.syncing') : t('detail.sync')}
          </Button>
          <Button onClick={onEdit}>{t('detail.edit')}</Button>
          <Button onClick={() => openExternal(`${site.url}/wp-admin/`)}>{t('detail.browserLogin')}</Button>
        </div>
      </div>

      <section className="mb-4">
        <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('detail.siteInfo')}</h3>
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard
            label={t('detail.posts')}
            value={s?.publishedCount != null ? formatNumber(s.publishedCount) : dash}
            sub={s?.draftCount != null ? t('detail.draftsCount', { count: s.draftCount }) : undefined}
          />
          <SummaryCard label={t('detail.mcpAdapter')} value={s?.mcpAdapterVersion ?? dash} />
          <SummaryCard
            label={t('detail.mcpEndpoint')}
            value={
              s?.mcpEndpointReachable == null
                ? dash
                : s.mcpEndpointReachable
                  ? t('detail.endpointValid')
                  : t('detail.endpointError')
            }
          />
        </div>
      </section>

      <section className="mb-4">
        <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('detail.connectionSettings')}</h3>
        <Card className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          <Row label={t('detail.siteUrl')} value={site.url} />
          <Row label={t('detail.authMethod')} value={t('detail.applicationPassword')} />
          <Row label={t('detail.username')} value={site.username} />
          <Row label={t('detail.mcpEndpoint')} value={site.mcpEndpoint} />
        </Card>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('detail.mcpLinkState')}</h3>
        <Card className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium">claude_desktop_config.json</p>
            <p className="text-xs text-zinc-500">{connStateLabel}</p>
          </div>
          <Toggle checked={site.enabled} onChange={() => void toggleConnection(site)} />
        </Card>
        {site.connection === 'connected_pending_restart' && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('detail.restartHint')}</p>
        )}
      </section>

      <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
          {t('detail.deleteSite')}
        </Button>
      </div>

      {confirmingDelete && (
        <Modal title={t('deleteDialog.title')} onClose={() => setConfirmingDelete(false)}>
          <p className="text-sm">
            {site.enabled
              ? t('deleteDialog.bodyConnected', { name: site.name })
              : t('deleteDialog.body', { name: site.name })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmingDelete(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmingDelete(false);
                void removeSite(site.id);
              }}
            >
              {t('deleteDialog.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate pl-4 font-mono text-xs">{value}</span>
    </div>
  );
}
