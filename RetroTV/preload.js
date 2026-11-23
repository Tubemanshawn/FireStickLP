// ===== Bridge between the window and the Fire Stick =====
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fire', {
  key: (name) => ipcRenderer.invoke('fire-key', name),
  longPress: (name) => ipcRenderer.invoke('fire-longpress', name),
  text: (t) => ipcRenderer.invoke('fire-text', t),
  connect: () => ipcRenderer.invoke('fire-connect'),
  config: () => ipcRenderer.invoke('fire-config'),
  setIp: (ip) => ipcRenderer.invoke('fire-set-ip', ip),
  disconnect: () => ipcRenderer.invoke('fire-disconnect'),
  sysStats: () => ipcRenderer.invoke('sys-stats'),
  freeRam: () => ipcRenderer.invoke('free-ram'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  launcherGet: () => ipcRenderer.invoke('launcher-get'),
  launcherSet: (on) => ipcRenderer.invoke('launcher-set', on),
  stopApp: (pkg) => ipcRenderer.invoke('app-stop', pkg),
  debloatGet: () => ipcRenderer.invoke('debloat-get'),
  debloatNow: () => ipcRenderer.invoke('debloat-now'),
  debloatAuto: (on) => ipcRenderer.invoke('debloat-auto', on),
  onDebloat: (cb) => ipcRenderer.on('debloat-status', (e, r) => cb(r)),
  toggleRemote: () => ipcRenderer.invoke('remote-toggle'),
  onStatus: (cb) => ipcRenderer.on('fire-status', (e, up) => cb(up)),
  onRemoteMode: (cb) => ipcRenderer.on('remote-mode', (e, on) => cb(on)),
  onLink: (cb) => ipcRenderer.on('remote-link', (e, state) => cb(state)),
});
