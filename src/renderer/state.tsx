/**
 * renderer のアプリ状態。window.api（IPC）越しに main の AppService を呼び、UI 状態を保持する。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSettings, Site, SiteWarning, ThemePref, WarningType } from '../shared/domain.js';
import type { SiteInput, TestResult } from '../shared/ipc.js';
import i18n from './i18n/index.js';

/** main から返る reason コードをローカライズ（無ければ素のメッセージにフォールバック）。 */
function localizeError(reason: string, fallback: string): string {
  const key = `errors.${reason}`;
  const translated = i18n.t(key);
  return translated === key ? fallback : translated;
}

export type View = 'main' | 'settings' | 'log';

export interface Toast {
  message: string;
  /** 再起動推奨トースト等のアクション */
  action?: { label: string; run: () => void };
}

interface AppState {
  sites: Site[];
  selectedId: string | null;
  view: View;
  settings: AppSettings | null;
  claudeDetected: boolean | null;
  configPath: string;
  toast: Toast | null;

  /** 重要なエラー（接続失敗等）をモーダルで提示する。 */
  alert: string | null;

  warnings: SiteWarning[];
  warningsFor: (siteId: string) => WarningType[];

  selected: Site | null;
  setView: (v: View) => void;
  selectSite: (id: string | null) => void;
  reload: () => Promise<void>;
  showToast: (t: Toast | null) => void;
  showAlert: (message: string | null) => void;

  /** 保存（新規/編集）＋認証情報。失敗時はローカライズ済みエラーメッセージを返す（成功時 null）。 */
  saveSite: (input: SiteInput, password: string, editingId: string | null) => Promise<string | null>;
  removeSite: (id: string) => Promise<void>;
  reorder: (orderedIds: string[]) => Promise<void>;
  testDraft: (input: SiteInput, password: string) => Promise<TestResult>;
  testSite: (id: string) => Promise<TestResult>;
  toggleConnection: (site: Site) => Promise<void>;
  syncSite: (id: string) => Promise<void>;
  restartClaude: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  openExternal: (url: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function applyTheme(pref: ThemePref): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', pref === 'dark' || (pref === 'system' && prefersDark));
}

export function AppStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('main');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [claudeDetected, setClaudeDetected] = useState<boolean | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SiteWarning[]>([]);

  const reload = useCallback(async () => {
    const [list, w] = await Promise.all([window.api.sites.list(), window.api.warnings.list()]);
    setSites(list);
    setWarnings(w);
  }, []);

  useEffect(() => {
    void (async () => {
      const [list, w, s, detected, cfg] = await Promise.all([
        window.api.sites.list(),
        window.api.warnings.list(),
        window.api.settings.get(),
        window.api.claude.detect(),
        window.api.claude.configPath(),
      ]);
      setSites(list);
      setWarnings(w);
      setSettings(s);
      setClaudeDetected(detected);
      setConfigPath(cfg);
      applyTheme(s.theme);
      if (list.length > 0) setSelectedId((prev) => prev ?? list[0]!.id);
    })();
  }, []);

  // main からのステータスプッシュで該当サイトを差し替える（§5.3.2 リアルタイム表示）
  useEffect(() => {
    const unsub = window.api.events.onSiteStatusChanged((site) => {
      setSites((prev) => prev.map((s) => (s.id === site.id ? site : s)));
    });
    return unsub;
  }, []);

  const warningsFor = useCallback(
    (siteId: string) => warnings.filter((w) => w.siteId === siteId).map((w) => w.type),
    [warnings],
  );

  const selected = useMemo(
    () => sites.find((s) => s.id === selectedId) ?? null,
    [sites, selectedId],
  );

  const restartClaude = useCallback(async () => {
    await window.api.claude.restart();
    setToast(null);
    await reload();
  }, [reload]);

  const recommendRestart = useCallback(() => {
    setToast({
      message: i18n.t('toast.restartToApply'),
      action: { label: i18n.t('toast.restart'), run: () => void restartClaude() },
    });
  }, [restartClaude]);

  const saveSite = useCallback<AppState['saveSite']>(
    async (input, password, editingId) => {
      const res = editingId
        ? await window.api.sites.update(editingId, input)
        : await window.api.sites.create(input);
      if (!res.ok) return localizeError(res.reason, res.message);

      if (password.trim().length > 0) {
        const sec = await window.api.secret.set(res.site.id, password);
        if (!sec.ok) return localizeError(sec.reason, '認証情報を保存できませんでした。');
      }
      await reload();
      setSelectedId(res.site.id);
      return null;
    },
    [reload],
  );

  const removeSite = useCallback<AppState['removeSite']>(
    async (id) => {
      await window.api.sites.remove(id);
      await reload();
      setSelectedId((prev) => (prev === id ? null : prev));
    },
    [reload],
  );

  const reorder = useCallback<AppState['reorder']>(
    async (orderedIds) => {
      await window.api.sites.reorder(orderedIds);
      await reload();
    },
    [reload],
  );

  const testDraft = useCallback<AppState['testDraft']>(
    (input, password) => window.api.test.run({ kind: 'draft', input, applicationPassword: password }),
    [],
  );
  const testSite = useCallback<AppState['testSite']>(
    (id) => window.api.test.run({ kind: 'site', siteId: id }),
    [],
  );

  const toggleConnection = useCallback<AppState['toggleConnection']>(
    async (site) => {
      if (site.enabled) {
        const res = await window.api.connection.off(site.id);
        if (!res.ok) {
          setAlert(localizeError(res.reason, res.message));
          return;
        }
        await reload();
        setToast({
          message: i18n.t('toast.disconnected'),
          action: { label: i18n.t('toast.restart'), run: () => void restartClaude() },
        });
      } else {
        const res = await window.api.connection.on(site.id);
        if (!res.ok) {
          setAlert(localizeError(res.reason, res.message));
          return;
        }
        await reload();
        recommendRestart();
      }
    },
    [reload, recommendRestart, restartClaude],
  );

  const syncSite = useCallback<AppState['syncSite']>(
    async (id) => {
      await window.api.sync.run(id);
      await reload();
    },
    [reload],
  );

  const updateSettings = useCallback<AppState['updateSettings']>(async (patch) => {
    const next = await window.api.settings.update(patch);
    setSettings(next);
    if (patch.theme) applyTheme(next.theme);
  }, []);

  const openExternal = useCallback<AppState['openExternal']>((url) => {
    void window.api.shell.openExternal(url);
  }, []);

  const value: AppState = {
    sites,
    selectedId,
    view,
    settings,
    claudeDetected,
    configPath,
    toast,
    alert,
    warnings,
    warningsFor,
    selected,
    setView,
    selectSite: setSelectedId,
    reload,
    showToast: setToast,
    showAlert: setAlert,
    saveSite,
    removeSite,
    reorder,
    testDraft,
    testSite,
    toggleConnection,
    syncSite,
    restartClaude,
    updateSettings,
    openExternal,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}
