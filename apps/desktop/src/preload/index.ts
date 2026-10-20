import { contextBridge, ipcRenderer } from 'electron';
import { buildProjectHubApi } from './api';

// O renderer recebe só a API montada aqui, em window.projectHub. O ipcRenderer fica no preload.
contextBridge.exposeInMainWorld(
  'projectHub',
  buildProjectHubApi(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    (channel, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },
  ),
);
