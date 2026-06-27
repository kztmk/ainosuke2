/**
 * preload — contextBridge で window.api（IpcApi）を renderer に公開する唯一の橋。
 * renderer は Node API に触れず、ここを通してのみ main と話す（§7 contextIsolation）。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_EVENT,
  IPC_INVOKE,
  type IpcApi,
} from '../shared/ipc.js';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: IpcApi = {
  sites: {
    list: () => ipcRenderer.invoke(IPC_INVOKE.sitesList),
    get: (id) => ipcRenderer.invoke(IPC_INVOKE.sitesGet, id),
    create: (input) => ipcRenderer.invoke(IPC_INVOKE.sitesCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC_INVOKE.sitesUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC_INVOKE.sitesRemove, id),
    reorder: (orderedIds) => ipcRenderer.invoke(IPC_INVOKE.sitesReorder, orderedIds),
  },
  secret: {
    set: (siteId, pw) => ipcRenderer.invoke(IPC_INVOKE.secretSet, siteId, pw),
    has: (siteId) => ipcRenderer.invoke(IPC_INVOKE.secretHas, siteId),
  },
  test: {
    run: (target) => ipcRenderer.invoke(IPC_INVOKE.testRun, target),
  },
  sync: {
    run: (siteId) => ipcRenderer.invoke(IPC_INVOKE.syncRun, siteId),
  },
  connection: {
    on: (siteId) => ipcRenderer.invoke(IPC_INVOKE.connectionOn, siteId),
    off: (siteId) => ipcRenderer.invoke(IPC_INVOKE.connectionOff, siteId),
  },
  claude: {
    detect: () => ipcRenderer.invoke(IPC_INVOKE.claudeDetect),
    configPath: () => ipcRenderer.invoke(IPC_INVOKE.claudeConfigPath),
    restart: () => ipcRenderer.invoke(IPC_INVOKE.claudeRestart),
    removeAllOwned: () => ipcRenderer.invoke(IPC_INVOKE.claudeRemoveAllOwned),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_INVOKE.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC_INVOKE.settingsUpdate, patch),
  },
  entitlement: {
    can: (feature) => ipcRenderer.invoke(IPC_INVOKE.entitlementCan, feature),
    siteLimit: () => ipcRenderer.invoke(IPC_INVOKE.entitlementSiteLimit),
  },
  log: {
    list: (filter) => ipcRenderer.invoke(IPC_INVOKE.logList, filter),
    exportCsv: (filter) => ipcRenderer.invoke(IPC_INVOKE.logExportCsv, filter),
  },
  warnings: {
    list: () => ipcRenderer.invoke(IPC_INVOKE.warningsList),
  },
  templates: {
    list: () => ipcRenderer.invoke(IPC_INVOKE.templatesList),
    create: (input) => ipcRenderer.invoke(IPC_INVOKE.templatesCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC_INVOKE.templatesUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC_INVOKE.templatesRemove, id),
  },
  license: {
    status: () => ipcRenderer.invoke(IPC_INVOKE.licenseStatus),
    deviceId: () => ipcRenderer.invoke(IPC_INVOKE.licenseDeviceId),
    activate: (token) => ipcRenderer.invoke(IPC_INVOKE.licenseActivate, token),
    deactivate: () => ipcRenderer.invoke(IPC_INVOKE.licenseDeactivate),
  },
  auth: {
    googleSignIn: () => ipcRenderer.invoke(IPC_INVOKE.authGoogleSignIn),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC_INVOKE.shellOpenExternal, url),
  },
  events: {
    onSiteStatusChanged: (cb) => subscribe(IPC_EVENT.siteStatusChanged, cb),
    onEncryptionAvailabilityChanged: (cb) => subscribe(IPC_EVENT.encryptionAvailabilityChanged, cb),
    onRestartRecommended: (cb) => subscribe(IPC_EVENT.restartRecommended, cb),
  },
};

contextBridge.exposeInMainWorld('api', api);
