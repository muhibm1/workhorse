import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/types';

// Stub until T10 wires the full PaddockApi. Only the system check is exposed so the renderer can
// fail fast when node or claude is missing.
contextBridge.exposeInMainWorld('paddock', {
  system: { check: () => ipcRenderer.invoke(IPC.systemCheck) },
});
