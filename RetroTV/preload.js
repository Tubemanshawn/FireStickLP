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
  setRemoteOff: (off) => ipcRenderer.invoke('remote-off-set', off),
  onStatus: (cb) => ipcRenderer.on('fire-status', (e, up) => cb(up)),
  onRemoteMode: (cb) => ipcRenderer.on('remote-mode', (e, on) => cb(on)),
  pipToggle: (cam) => ipcRenderer.invoke('pip-toggle', cam),
  pipClose: () => ipcRenderer.invoke('pip-close'),
  pipMove: (dx, dy) => ipcRenderer.invoke('pip-move', dx, dy),
  pipVol: (delta) => ipcRenderer.invoke('pip-vol', delta),        // mini -> main window
  onVol: (cb) => ipcRenderer.on('app-vol', (e, delta) => cb(delta)),
  pipVolShow: (text) => ipcRenderer.invoke('pip-vol-show', text),  // main -> mini window
  onVolShow: (cb) => ipcRenderer.on('vol-show', (e, text) => cb(text)),
  lookSet: (look) => ipcRenderer.invoke('look-set', look),        // main window -> mini window
  lookGet: () => ipcRenderer.invoke('look-get'),
  onLook: (cb) => ipcRenderer.on('look', (e, look) => cb(look)),
  onPip: (cb) => ipcRenderer.on('pip-state', (e, open) => cb(open)),
  onLink: (cb) => ipcRenderer.on('remote-link', (e, state) => cb(state)),
});
