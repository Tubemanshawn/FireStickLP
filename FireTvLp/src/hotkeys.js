// ===== Remote Mode: global keyboard hotkeys =====
// Ctrl+Alt+R (always on) toggles Remote Mode. While it's ON, these keys go to
// the Fire Stick from ANY app.

const { globalShortcut } = require('electron');
const { state, send } = require('./state');
const { KEYS, sendKey } = require('./remote');

const TOGGLE_HOTKEY = 'Control+Alt+R';
const MODE_KEYS = {
  Up: 'up', Down: 'down', Left: 'left', Right: 'right',
  Return: 'ok', Escape: 'back', Backspace: 'back',
  Home: 'home', Space: 'playpause',
};

function registerModeKeys() {
  for (const [accel, name] of Object.entries(MODE_KEYS)) {
    try { globalShortcut.register(accel, () => sendKey(KEYS[name])); } catch (e) {}
  }
}
function unregisterModeKeys() {
  for (const accel of Object.keys(MODE_KEYS)) {
    try { globalShortcut.unregister(accel); } catch (e) {}
  }
}

function setRemoteMode(on) {
  state.remoteMode = on;
  if (on) registerModeKeys(); else unregisterModeKeys();
  send('remote-mode', state.remoteMode);
  return state.remoteMode;
}

const toggleRemoteMode = () => setRemoteMode(!state.remoteMode);

function registerToggleHotkey() {
  globalShortcut.register(TOGGLE_HOTKEY, toggleRemoteMode);
}

module.exports = { toggleRemoteMode, registerToggleHotkey };
