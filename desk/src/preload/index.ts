import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@shared/types';
import type { ChangeDigest, PaddockApi, RunEnvelope } from '@shared/types';

/** The full typed bridge (plan Task 10). Every call is a thin `ipcRenderer.invoke`/`on` wrapper —
 *  no logic lives here, so the shape of `PaddockApi` is the single source of truth main and the
 *  renderer both compile against. */
const api: PaddockApi = {
  system: {
    check: () => ipcRenderer.invoke(IPC.systemCheck),
  },

  repos: {
    list: () => ipcRenderer.invoke(IPC.reposList),
    add: (path) => ipcRenderer.invoke(IPC.reposAdd, path),
    remove: (id) => ipcRenderer.invoke(IPC.reposRemove, id),
    pickFolder: () => ipcRenderer.invoke(IPC.reposPick),
  },

  fleet: {
    digest: (repoId) => ipcRenderer.invoke(IPC.fleetDigest, repoId),
  },

  artifact: {
    read: (repoId, relPath) => ipcRenderer.invoke(IPC.artifactRead, repoId, relPath),
  },

  run: {
    start: (repoId, prompt) => ipcRenderer.invoke(IPC.runStart, repoId, prompt),
    resume: (repoId) => ipcRenderer.invoke(IPC.runResume, repoId),
    stop: (runId) => ipcRenderer.invoke(IPC.runStop, runId),
    onEvent: (cb) => {
      const listener = (_event: IpcRendererEvent, envelope: RunEnvelope): void => cb(envelope);
      ipcRenderer.on(IPC.runEvent, listener);
      return () => ipcRenderer.removeListener(IPC.runEvent, listener);
    },
  },

  gate: {
    approve: (repoId, gate, notes) => ipcRenderer.invoke(IPC.gateApprove, repoId, gate, notes),
    reject: (repoId, gate, notes) => ipcRenderer.invoke(IPC.gateReject, repoId, gate, notes),
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    setApiKey: (key) => ipcRenderer.invoke(IPC.settingsSetKey, key),
    hasApiKey: () => ipcRenderer.invoke(IPC.settingsHasKey),
    clearApiKey: () => ipcRenderer.invoke(IPC.settingsClearKey),
  },

  watch: {
    onDigest: (cb) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { repoId: string; digests: ChangeDigest[]; onboarded: boolean },
      ): void => cb(payload);
      ipcRenderer.on(IPC.watchDigest, listener);
      return () => ipcRenderer.removeListener(IPC.watchDigest, listener);
    },
  },

  studbook: {
    status: () => ipcRenderer.invoke(IPC.studbookStatus),
    check: () => ipcRenderer.invoke(IPC.studbookCheck),
    repos: () => ipcRenderer.invoke(IPC.studbookRepos),
    search: (question, scope, topK) => ipcRenderer.invoke(IPC.studbookSearch, question, scope, topK),
    ask: (question, scope, topK) => ipcRenderer.invoke(IPC.studbookAsk, question, scope, topK),
    setConninfo: (conninfo) => ipcRenderer.invoke(IPC.studbookSetConninfo, conninfo),
    hasConninfo: () => ipcRenderer.invoke(IPC.studbookHasConninfo),
    clearConninfo: () => ipcRenderer.invoke(IPC.studbookClearConninfo),
    setIngestConninfo: (conninfo) => ipcRenderer.invoke(IPC.studbookSetIngestConninfo, conninfo),
    hasIngestConninfo: () => ipcRenderer.invoke(IPC.studbookHasIngestConninfo),
    clearIngestConninfo: () => ipcRenderer.invoke(IPC.studbookClearIngestConninfo),
    sync: () => ipcRenderer.invoke(IPC.studbookSync),
  },
};

contextBridge.exposeInMainWorld('paddock', api);
