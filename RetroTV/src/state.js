// ===== Shared state =====
// One object that every module reads and writes, so the pieces don't have to
// pass the Fire Stick address, connection status, settings and window around.

const state = {
  // Fire Stick address, e.g. "192.168.1.50:5555". Empty until the user sets it
  // (saved to settings.json and mirrored to ..\..\fire-ip.txt for the scripts).
  fireIp: '',

  // Connection
  fireUp: false,       // adb can reach the Fire Stick
  manualOff: false,    // user pressed Disconnect: don't auto-reconnect

  // Saved settings
  autoDebloat: true,   // re-debloat on connect / after reboots
  launcherSwap: false, // use a lighter home screen (e.g. Projectivy)

  // Remote
  remoteMode: false,   // global keyboard hotkeys go to the Fire Stick
  lastKeyAt: 0,        // last time a key was sent (any path)
  lastFocusAt: Date.now(),

  // Debloat
  lastBootId: '',      // Fire Stick boot id at the last debloat

  // Launcher
  replacementHome: null, // e.g. com.spocky.projengmenu/.ui.home.MainActivity

  // RAM
  cacheLimitWorks: true,

  // The app window (null until created)
  win: null,
};

// Send a message to the window if it exists.
function send(channel, ...args) {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send(channel, ...args);
}

module.exports = { state, send };
