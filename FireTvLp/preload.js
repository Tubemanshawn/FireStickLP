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
  toggleRemote: () => ipcRenderer.invoke('remote-toggle'),
  setRemoteOff: (off) => ipcRenderer.invoke('remote-off-set', off),
  onStatus: (cb) => ipcRenderer.on('fire-status', (e, up) => cb(up)),
  onRemoteMode: (cb) => ipcRenderer.on('remote-mode', (e, on) => cb(on)),
  onLink: (cb) => ipcRenderer.on('remote-link', (e, state) => cb(state)),
});
