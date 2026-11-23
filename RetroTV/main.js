// ===== Retro TV - Electron main process =====
// Window, single-instance lock, timers, and the messages between the window
// and the Fire Stick code in ./src.
//
//   src/state.js     shared state (address, connection, settings, window)
//   src/settings.js  load/save settings.json
//   src/adb.js       running adb commands, slow-path queue, parsers
//   src/remote.js    fast key channel (monkey), keys, long-press, typing, Home
//   src/device.js    connect / change address / disconnect
//   src/debloat.js   auto debloat + reboot detection
//   src/ram.js       cached-app limit, Free RAM, backup cleanup
//   src/launcher.js  lighter home screen, sweeper, Fire TV Settings
//   src/system.js    System tab stats, Stop button
//   src/hotkeys.js   Remote Mode global hotkeys

const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
const path = require('path');
const { claimAppLock } = require('./src/applock');

// Retro TV is the "A" line (full app); FireTvLp is the "B" line (screen + remote).
const APP_NAME = 'Retro TV';
const VERSION_LABEL = 'A' + app.getVersion();   // A1.0.0

const { state } = require('./src/state');
const { loadSettings, saveSettings } = require('./src/settings');
const { KEYS, sendKey, longPress, sendText, superviseMonkey, stopMonkey } = require('./src/remote');
const { CHECK_EVERY_MS, connect, setFireIp, disconnectFire, setRemoteOff } = require('./src/device');
const { runDebloat, maybeAutoDebloat, getLastDebloat } = require('./src/debloat');
const { CLEANUP_EVERY_MS, freeRam, periodicCleanup } = require('./src/ram');
const { SWEEP_EVERY_MS, applyLauncherSwap, undoLauncherSwap, sweepLauncher, openFireSettings } = require('./src/launcher');
const { sysStats, stopApp } = require('./src/system');
const { toggleRemoteMode, registerToggleHotkey } = require('./src/hotkeys');

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

ipcMain.handle('sys-stats', () => sysStats());
ipcMain.handle('free-ram', () => (state.fireUp ? freeRam() : { ok: false }));
ipcMain.handle('app-stop', (e, pkg) => stopApp(pkg));
ipcMain.handle('open-settings', () => openFireSettings());

ipcMain.handle('launcher-get', () => ({ on: state.launcherSwap }));
ipcMain.handle('launcher-set', async (e, on) => {
  state.launcherSwap = !!on; saveSettings();
  if (!state.fireUp) return { on: state.launcherSwap, text: 'saved; applies when the Fire Stick connects' };
  const r = state.launcherSwap ? await applyLauncherSwap() : await undoLauncherSwap();
  return { on: state.launcherSwap, ...r };
});

ipcMain.handle('debloat-get', () => ({ auto: state.autoDebloat, last: getLastDebloat() }));
ipcMain.handle('debloat-now', () => runDebloat('Debloat now button'));
ipcMain.handle('debloat-auto', (e, on) => {
  state.autoDebloat = !!on; saveSettings();
  if (state.autoDebloat) { state.lastBootId = ''; maybeAutoDebloat(); }   // turning it on runs it now
  return state.autoDebloat;
});

// ---- Mini TV window (the â§‰ Pop out button) ----
// Our own always-on-top window instead of Chromium's picture-in-picture,
// because PiP windows don't pass the mouse wheel / clicks to the app.
let pipWin = null;
const pipOpen = () => !!pipWin && !pipWin.isDestroyed();
function tellPipState() { if (state.win && !state.win.isDestroyed()) state.win.webContents.send('pip-state', pipOpen()); }

function togglePip(cam) {
  if (pipOpen()) { pipWin.close(); return false; }
  pipWin = new BrowserWindow({
    width: 480, height: 270, minWidth: 192, minHeight: 108,
    frame: false, alwaysOnTop: true, resizable: true, skipTaskbar: false,
    backgroundColor: '#000000', title: 'Retro TV mini',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  pipWin.setAspectRatio(16 / 9);
  pipWin.setAlwaysOnTop(true, 'floating');
  pipWin.loadFile('pip.html', { query: { cam: cam || '' } });
  pipWin.on('focus', () => { state.lastFocusAt = Date.now(); superviseMonkey(); });
  pipWin.on('blur', () => { state.lastFocusAt = Date.now(); });
  pipWin.on('closed', () => { pipWin = null; tellPipState(); });
  tellPipState();
  return true;
}
ipcMain.handle('pip-toggle', (e, cam) => togglePip(cam));
ipcMain.handle('pip-close', () => { if (pipOpen()) pipWin.close(); });
// Volume lives in the main window (it plays the sound); the mini window
// forwards its scrolls there and shows the level it gets back.
ipcMain.handle('pip-vol', (e, delta) => {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('app-vol', delta);
});
ipcMain.handle('pip-vol-show', (e, text) => { if (pipOpen()) pipWin.webContents.send('vol-show', text); });
// Skin + effects: the main window owns them; the mini window copies them.
let currentLook = { skin: 'plain', fx: [], up: false };
ipcMain.handle('look-set', (e, look) => {
  currentLook = look;
  if (pipOpen()) pipWin.webContents.send('look', look);
});
ipcMain.handle('look-get', () => currentLook);
ipcMain.handle('pip-move', (e, dx, dy) => {
  if (!pipOpen()) return;
  const [x, y] = pipWin.getPosition();
  pipWin.setPosition(Math.round(x + dx), Math.round(y + dy));
});

// ---- Window ----
// Force the window onto the screen. hide() first, because Windows can leave
// a window invisible while Electron believes it's shown (happens when the
// app was started by something that asked for a hidden start).
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
    width: 1100, height: 760,
    backgroundColor: '#0b0b0b',
    title: `Retro TV ${VERSION_LABEL}`,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  state.win = win;
  win.setMenuBarVisibility(false);
  win.on('page-title-updated', (e) => e.preventDefault());   // keep the title with the version
  win.loadFile('renderer.html');
  win.once('ready-to-show', bringToFront);
  // Window focus wakes the remote helper; leaving starts its 2-minute countdown.
  win.on('focus', () => { state.lastFocusAt = Date.now(); superviseMonkey(); });
  win.on('blur', () => { state.lastFocusAt = Date.now(); });
  win.on('closed', () => { if (pipOpen()) pipWin.close(); });   // the mini window goes with it

  connect();
  setInterval(connect, CHECK_EVERY_MS);            // re-check the connection
  setInterval(superviseMonkey, SUPERVISE_EVERY_MS); // keep the fast key channel healthy
  setInterval(sweepLauncher, SWEEP_EVERY_MS);       // close Amazon home when it's in the background
  setInterval(periodicCleanup, CLEANUP_EVERY_MS);   // only if Fire OS ignores the cached-app limit
}

// ---- Only one copy of the app at a time ----
// Two copies would fight over the Fire Stick connection (each one's cleanup
// kills the other's monkey), which can jam adb on the Fire Stick. Opening the
// app again just brings the existing window to the front.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another copy owns the connection: leave immediately, without cleanup.
  app.exit(0);
} else {
  app.on('second-instance', bringToFront);
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  // FireTvLp open? Then step aside (without touching the Fire Stick).
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
  if (!gotLock) return;            // a copy that stepped aside must not touch the Fire Stick
  globalShortcut.unregisterAll();
  stopMonkey();
});
app.on('window-all-closed', () => app.quit());
