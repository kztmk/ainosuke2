/**
 * NoteAccount — note 投稿先のログイン・接続 UI（ADR-0008 D・Pro／ベータ）。
 *
 * ログインは main の BrowserWindow で行い（Claude には触らせない）、接続は config に
 * bridge エントリを書くだけ（note 認証情報は config に出ない）。初回は非公式 API の同意を取る。
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteStatus } from '../../shared/ipc.js';
import { Button, Card, Modal, Toggle } from './ui.js';

const CONSENT_KEY = 'note.consent.v1';

export function NoteAccount(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<NoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [askConsent, setAskConsent] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await window.api.note.status());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doLogin = useCallback(async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await window.api.note.login();
      if (!r.ok) {
        setError(t(r.reason === 'encryption_unavailable' ? 'note.encryptionUnavailable' : 'note.loginFailed'));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  const onLoginClick = useCallback(() => {
    if (localStorage.getItem(CONSENT_KEY) !== '1') {
      setAskConsent(true);
      return;
    }
    void doLogin();
  }, [doLogin]);

  const agreeConsent = useCallback(() => {
    localStorage.setItem(CONSENT_KEY, '1');
    setAskConsent(false);
    void doLogin();
  }, [doLogin]);

  const onToggleConnect = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const r = next ? await window.api.note.connect() : await window.api.note.disconnect();
        if (!r.ok) {
          setError(r.reason === 'needs_login' ? t('note.needsLogin') : (r.message ?? t('note.loginFailed')));
        } else if (next) {
          setInfo(t('note.needRestart'));
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  const onLogout = useCallback(async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await window.api.note.logout();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const loggedIn = status?.loginState === 'logged_in';

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t('note.section')}</h3>
        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
          {t('note.pro')}
        </span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {t('note.beta')}
        </span>
      </div>
      <p className="text-xs text-zinc-500">{t('note.desc')}</p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={loggedIn ? 'text-green-500' : 'text-amber-500'}>●</span>
        <span>{loggedIn ? t('note.stateLoggedIn') : t('note.stateNeedsRelogin')}</span>
        {loggedIn && status?.urlname && (
          <span className="text-zinc-500">— {t('note.loggedInAs', { urlname: status.urlname })}</span>
        )}
      </div>

      {loggedIn ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">{t('note.connectToggle')}</span>
            <Toggle checked={!!status?.connected} onChange={onToggleConnect} disabled={busy} />
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{status?.connected ? t('note.connected') : t('note.notConnected')}</span>
            {status?.hostRunning && <span>· {t('note.hostRunning')}</span>}
          </div>
          <Button variant="default" onClick={onLogout} disabled={busy}>
            {t('note.logout')}
          </Button>
        </div>
      ) : (
        <Button variant="primary" onClick={onLoginClick} disabled={busy}>
          {busy ? t('note.loggingIn') : t('note.login')}
        </Button>
      )}

      {info && <p className="text-xs text-blue-500">{info}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {askConsent && (
        <Modal title={t('note.consentTitle')} onClose={() => setAskConsent(false)}>
          <p className="whitespace-pre-line text-sm">{t('note.consentBody')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="default" onClick={() => setAskConsent(false)}>
              {t('note.consentCancel')}
            </Button>
            <Button variant="primary" onClick={agreeConsent}>
              {t('note.consentAgree')}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
