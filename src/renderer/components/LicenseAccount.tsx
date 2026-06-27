/**
 * ライセンスのアカウント連携（§12.2・段階1: Email/Password）。
 *
 * フロー: Firebase Auth サインイン → （未購入なら）Stripe Checkout → サブスク有効化を検知 →
 * issueLicense で署名トークン取得 → window.api.license.activate(token)（main が Ed25519 検証・保存）。
 * Google サインインは段階2（システムブラウザのループバック）で追加予定。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BILLING_PLANS } from '../../shared/billing.js';
import {
  authErrorCode,
  issueLicense,
  listDevices,
  onAuth,
  revokeDevice,
  signInEmail,
  signInWithGoogleIdToken,
  signOutUser,
  signUpEmail,
  startCheckout,
  watchActiveSubscription,
  type DeviceInfo,
  type User,
} from '../firebase/client.js';
import { Button, Field, TextInput } from './ui.js';

function deviceName(): string {
  const platform = typeof navigator !== 'undefined' ? navigator.platform : '';
  return platform ? `WP MCP Manager (${platform})` : 'WP MCP Manager';
}

/** callable のエラーメッセージ（HttpsError message）を i18n キーへ対応付ける。 */
function callableErrorKey(message: string): string {
  switch (message) {
    case 'no-active-subscription':
      return 'license.errNoSub';
    case 'device-limit-reached':
      return 'license.errDeviceLimit';
    case 'sign-in-required':
      return 'license.errSignIn';
    default:
      return '';
  }
}

export function LicenseAccount({
  isPro,
  deviceId,
  onActivated,
}: {
  isPro: boolean;
  deviceId: string;
  onActivated: () => Promise<void> | void;
}): JSX.Element {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [subActive, setSubActive] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [maxDevices, setMaxDevices] = useState(3);
  const autoIssuedFor = useRef<string | null>(null);

  useEffect(() => {
    return onAuth((u) => {
      setUser(u);
      setAuthReady(true);
      setError(null);
      setInfo(null);
      if (!u) {
        setSubActive(null);
        setDevices(null);
        autoIssuedFor.current = null;
      }
    });
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const r = await listDevices();
      setDevices(r.devices);
      setMaxDevices(r.maxDevices);
    } catch {
      /* 未サインイン等は無視 */
    }
  }, []);

  // サブスク状態の監視
  useEffect(() => {
    if (!user) return;
    void loadDevices();
    return watchActiveSubscription(user.uid, (active) => setSubActive(active));
  }, [user, loadDevices]);

  const doIssue = useCallback(async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const issued = await issueLicense(deviceId, deviceName());
      const res = await window.api.license.activate(issued.token);
      if (!res.ok) {
        setError(t('license.activateError', { reason: res.reason }));
        return;
      }
      setInfo(t('license.activatedOk'));
      await onActivated();
      await loadDevices();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const key = callableErrorKey(msg);
      setError(key ? t(key, { max: maxDevices }) : t('license.issueError', { message: msg }));
    } finally {
      setBusy(false);
    }
  }, [deviceId, t, onActivated, loadDevices, maxDevices]);

  // サブスク有効を検知したら（未 Pro なら）自動で一度だけ発行を試みる
  useEffect(() => {
    if (!user || isPro || subActive !== true || busy) return;
    if (autoIssuedFor.current === user.uid) return;
    autoIssuedFor.current = user.uid;
    void doIssue();
  }, [user, isPro, subActive, busy, doIssue]);

  async function doAuth(): Promise<void> {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signup') await signUpEmail(email.trim(), password);
      else await signInEmail(email.trim(), password);
      setPassword('');
    } catch (e) {
      setError(t('license.authError', { code: authErrorCode(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function doGoogle(): Promise<void> {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const r = await window.api.auth.googleSignIn();
      if (!r.ok) {
        setError(t('license.googleError', { reason: r.reason }));
        return;
      }
      await signInWithGoogleIdToken(r.idToken);
    } catch (e) {
      setError(t('license.authError', { code: authErrorCode(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function doCheckout(priceId: string): Promise<void> {
    if (!user) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const url = await startCheckout(user.uid, priceId);
      await window.api.shell.openExternal(url);
      setInfo(t('license.checkoutOpened'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(t('license.issueError', { message: msg }));
    } finally {
      setBusy(false);
    }
  }

  async function doRevoke(id: string): Promise<void> {
    try {
      await revokeDevice(id);
      await loadDevices();
    } catch {
      /* noop */
    }
  }

  if (!authReady) return <p className="text-xs text-zinc-400">…</p>;

  // 未サインイン: サインイン/サインアップフォーム
  if (!user) {
    return (
      <div className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {mode === 'signup' ? t('license.signUpTitle') : t('license.signInTitle')}
        </p>
        <Field label={t('license.email')}>
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field label={t('license.password')}>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => void doAuth()} disabled={busy || !email.trim() || !password}>
            {busy ? t('license.signingIn') : mode === 'signup' ? t('license.signUp') : t('license.signIn')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
              setError(null);
            }}
          >
            {mode === 'signin' ? t('license.toSignUp') : t('license.toSignIn')}
          </Button>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          <span className="text-xs text-zinc-400">{t('license.or')}</span>
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <Button variant="default" onClick={() => void doGoogle()} disabled={busy} className="w-full">
          {t('license.googleSignIn')}
        </Button>
      </div>
    );
  }

  // サインイン済み
  const currentInList = devices?.some((d) => d.deviceId === deviceId);
  return (
    <div className="space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <p className="break-all text-xs text-zinc-600 dark:text-zinc-400">
          {t('license.signedInAs', { email: user.email ?? '' })}
        </p>
        <Button variant="ghost" onClick={() => void signOutUser()}>
          {t('license.signOut')}
        </Button>
      </div>

      {!isPro && (
        <div className="space-y-2">
          {subActive === true ? (
            <Button variant="primary" onClick={() => void doIssue()} disabled={busy}>
              {busy ? t('license.activating') : t('license.activatePro')}
            </Button>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-500">{t('license.subNone')}</p>
              <div className="flex flex-wrap gap-2">
                {BILLING_PLANS.map((p) => (
                  <Button key={p.interval} variant="primary" onClick={() => void doCheckout(p.priceId)} disabled={busy}>
                    {t('license.buyPlan', { label: p.amountLabel })}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {info && <p className="text-xs text-green-600 dark:text-green-400">{info}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* 端末管理（最大 maxDevices 台） */}
      {devices && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t('license.devices', { count: devices.length, max: maxDevices })}
          </p>
          <ul className="space-y-1">
            {devices.map((d) => (
              <li key={d.deviceId} className="flex items-center justify-between gap-2 text-xs">
                <span className="break-all text-zinc-500">
                  {d.name ?? d.deviceId}
                  {d.deviceId === deviceId && <span className="ml-1 text-zinc-400">{t('license.deviceCurrent')}</span>}
                </span>
                <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => void doRevoke(d.deviceId)}>
                  {t('license.revoke')}
                </Button>
              </li>
            ))}
          </ul>
          {!currentInList && !isPro && (
            <p className="text-xs text-zinc-400">{t('license.deviceNotRegistered')}</p>
          )}
        </div>
      )}
    </div>
  );
}
