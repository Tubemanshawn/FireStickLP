// ===== FireTvLp - Electron main process =====
// The "B" line of FireStickLP: just the capture-card screen and the Fire
// Stick remote. (Retro TV, the "A" line, keeps debloat / RAM / skins.)
//
//   src/state.js     shared state (address, connection, window)
//   src/settings.js  load/save settings.json (+ the shared ..\fire-ip.txt)
//   src/adb.js       running adb commands
//   src/remote.js    fast key channel (monkey), keys, long-press, typing, Home
//   src/device.js    connect / change address / disconnect
//   src/launcher.js  finds Projectivy, so Home doesn't land on Amazon's home
//   src/hotkeys.js   Remote Mode global hotkeys
//   src/applock.js   only one of Retro TV / FireTvLp open at a time

const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
const path = require('path');

const { state } = require('./src/state');
const { loadSettings } = require('./src/settings');
const { KEYS, sendKey, longPress, sendText, superviseMonkey, stopMonkey } = require('./src/remote');
const { CHECK_EVERY_MS, connect, setFireIp, disconnectFire, setRemoteOff } = require('./src/device');
const { toggleRemoteMode, registerToggleHotkey } = require('./src/hotkeys');
const { claimAppLock } = require('./src/applock');

const APP_NAME = 'FireTvLp';
const VERSION_LABEL = 'B' + app.getVersion();   // B1.0.0
const SUPERVISE_EVERY_MS = 2000;

// ---- Messages from the window ----
const keyCode = (name) => KEYS[name] ?? name;
ipcMain.handle('fire-key', (e, name) => sendKey(keyCode(name)));
ipcMain.handle('fire-longpress', (e, name) => longPress(keyCode(name)));
ipcMain.handle('fire-text', (e, text) => sendText(text));
ipcMain.handle('fire-connect', () => { state.manualOff = false; return connect(); });
ipcMain.handle('fire-config', () => ({ ip: state.fireIp, off: state.manualOff, remoteOff: state.remoteOff, version: VERSION_LABEL }));
ipcMain.handle('remote-off-set', (e, off) => setRemoteOff(off));
ipcMain.handle('fire-set-ip', (e, ip) => setFireIp(ip));
ipcMain.handle('fire-disconnect', () => disconnectFire());
ipcMain.handle('remote-toggle', () => toggleRemoteMode());

// ---- Window ----
function bringToFront() {
  const win = state.win;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.hide();
  win.show();
  win.focus();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 700,
    backgroundColor: '#0b0b0b',
    title: `${APP_NAME} ${VERSION_LABEL}`,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  state.win = win;
  win.setMenuBarVisibility(false);
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadFile('index.html');
  win.once('ready-to-show', bringToFront);
  win.on('focus', () => { state.lastFocusAt = Date.now(); superviseMonkey(); });
  win.on('blur', () => { state.lastFocusAt = Date.now(); });

  connect();
  setInterval(connect, CHECK_EVERY_MS);
  setInterval(superviseMonkey, SUPERVISE_EVERY_MS);
}

// ---- Only one copy, and never together with Retro TV ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.exit(0);
else app.on('second-instance', bringToFront);

app.whenReady().then(async () => {
  if (!gotLock) return;
  const lock = await claimAppLock(APP_NAME);
  if (!lock.ok) {
    dialog.showErrorBox(APP_NAME, `${lock.other} is already open. Close it first, then open ${APP_NAME}.`);
    app.exit(0);
    return;
  }
  loadSettings();
  createWindow();
  registerToggleHotkey();
});

app.on('will-quit', () => {
  if (!gotLock) return;
  globalShortcut.unregisterAll();
  stopMonkey();
});
app.on('window-all-closed', () => app.quit());
