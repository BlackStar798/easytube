'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getLocales: () => ipcRenderer.invoke('i18n:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  removeHistory: (id) => ipcRenderer.invoke('history:remove', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  analyze: (url) => ipcRenderer.invoke('analyze', url),
  download: (opts) => ipcRenderer.invoke('download:start', opts),
  cancel: () => ipcRenderer.invoke('download:cancel'),
  chooseFolder: (current) => ipcRenderer.invoke('folder:choose', current),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openDataFolder: () => ipcRenderer.invoke('shell:openData'),
  getInfo: () => ipcRenderer.invoke('app:info'),
  updateEngine: () => ipcRenderer.invoke('engine:update'),
  getAbout: () => ipcRenderer.invoke('about:info'),
  openLicenses: () => ipcRenderer.invoke('about:openLicenses'),
  openRepo: () => ipcRenderer.invoke('about:openRepo'),
  chooseCookiesFile: () => ipcRenderer.invoke('cookies:chooseFile'),
  clearCookiesFile: () => ipcRenderer.invoke('cookies:clearFile'),
  copyDiagnostics: (extra) => ipcRenderer.invoke('diagnostics:copy', extra),
  checkAppUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openReleases: () => ipcRenderer.invoke('app:openReleases'),
  onProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('download:progress', h);
    return () => ipcRenderer.removeListener('download:progress', h);
  },
  onUpdateAvailable: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('engine:update-available', h);
    return () => ipcRenderer.removeListener('engine:update-available', h);
  },
  // macOS application menu: 'about' | 'settings'
  onMenu: (cb) => {
    const h = (_e, action) => cb(action);
    ipcRenderer.on('ui:menu', h);
    return () => ipcRenderer.removeListener('ui:menu', h);
  },
  onAppUpdateAvailable: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('app:update-available', h);
    return () => ipcRenderer.removeListener('app:update-available', h);
  },
});
