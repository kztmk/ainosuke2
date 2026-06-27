/**
 * registerHandlers — IPC_INVOKE チャンネルを AppService のメソッドに結線する薄いアダプタ。
 * ロジックは持たず、引数を渡して結果を返すだけ。
 */
import { ipcMain } from 'electron';
import { IPC_INVOKE } from '../../shared/ipc.js';
import type { AppService } from '../appService/appService.js';
import type { GoogleSignInResult, LogFilter, SiteInput, TemplateInput, TestTarget } from '../../shared/ipc.js';
import type { AppSettings, Feature } from '../../shared/domain.js';

/** AppService に属さない main 固有のハンドラ（OAuth 等）。 */
export interface ExtraHandlers {
  googleSignIn(): Promise<GoogleSignInResult>;
}

export function registerHandlers(app: AppService, extra: ExtraHandlers): void {
  const h = ipcMain.handle.bind(ipcMain);

  h(IPC_INVOKE.sitesList, () => app.sitesList());
  h(IPC_INVOKE.sitesGet, (_e, id: string) => app.sitesGet(id));
  h(IPC_INVOKE.sitesCreate, (_e, input: SiteInput) => app.sitesCreate(input));
  h(IPC_INVOKE.sitesUpdate, (_e, id: string, input: SiteInput) => app.sitesUpdate(id, input));
  h(IPC_INVOKE.sitesRemove, (_e, id: string) => app.sitesRemove(id));
  h(IPC_INVOKE.sitesReorder, (_e, orderedIds: string[]) => app.sitesReorder(orderedIds));

  h(IPC_INVOKE.secretSet, (_e, siteId: string, pw: string) => app.secretSet(siteId, pw));
  h(IPC_INVOKE.secretHas, (_e, siteId: string) => app.secretHas(siteId));

  h(IPC_INVOKE.testRun, (_e, target: TestTarget) => app.testRun(target));
  h(IPC_INVOKE.syncRun, (_e, siteId: string) => app.syncRun(siteId));

  h(IPC_INVOKE.connectionOn, (_e, siteId: string) => app.connectionOn(siteId));
  h(IPC_INVOKE.connectionOff, (_e, siteId: string) => app.connectionOff(siteId));

  h(IPC_INVOKE.claudeDetect, () => app.claudeDetect());
  h(IPC_INVOKE.claudeConfigPath, () => app.claudeConfigPath());
  h(IPC_INVOKE.claudeRestart, () => app.claudeRestart());
  h(IPC_INVOKE.claudeRemoveAllOwned, () => app.claudeRemoveAllOwned());

  h(IPC_INVOKE.settingsGet, () => app.settingsGet());
  h(IPC_INVOKE.settingsUpdate, (_e, patch: Partial<AppSettings>) => app.settingsUpdate(patch));

  h(IPC_INVOKE.entitlementCan, (_e, feature: Feature) => app.entitlementCan(feature));
  h(IPC_INVOKE.entitlementSiteLimit, () => app.entitlementSiteLimit());

  h(IPC_INVOKE.logList, (_e, filter?: LogFilter) => app.logList(filter));
  h(IPC_INVOKE.logExportCsv, (_e, filter?: LogFilter) => app.exportLogsCsv(filter));

  h(IPC_INVOKE.warningsList, () => app.getWarnings());

  h(IPC_INVOKE.templatesList, () => app.templatesList());
  h(IPC_INVOKE.templatesCreate, (_e, input: TemplateInput) => app.templatesCreate(input));
  h(IPC_INVOKE.templatesUpdate, (_e, id: string, input: TemplateInput) => app.templatesUpdate(id, input));
  h(IPC_INVOKE.templatesRemove, (_e, id: string) => app.templatesRemove(id));

  h(IPC_INVOKE.licenseStatus, () => app.licenseStatus());
  h(IPC_INVOKE.licenseDeviceId, () => app.licenseDeviceId());
  h(IPC_INVOKE.licenseActivate, (_e, token: string) => app.licenseActivate(token));
  h(IPC_INVOKE.licenseDeactivate, () => app.licenseDeactivate());

  h(IPC_INVOKE.authGoogleSignIn, () => extra.googleSignIn());

  h(IPC_INVOKE.shellOpenExternal, (_e, url: string) => app.shellOpenExternal(url));
}
