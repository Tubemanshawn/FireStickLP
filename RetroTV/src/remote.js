// ===== Remote: sending keys and text to the Fire Stick =====
//
// Fast channel: Android's built-in "monkey" server. "input keyevent" starts a
// Java program on the Fire Stick for every press (~0.9s each); monkey starts
// once and then takes key presses over a socket in ~10-50ms.
//
// IMPORTANT: once a client connects, monkey opens a UI Automation link, and
// while that exists Android switches OFF every accessibility service, which
// kills the Home-button redirect (Home on Fire / Projectivy). Disconnecting
// doesn't release it; only closing monkey does. So:
//  - monkey is kept running but UNCONNECTED ("warm") in the background
//  - on a key press we connect (~60ms) and send
//  - after IDLE_RELEASE_MS without presses, that monkey is closed and a fresh
//    unconnected one is started, so the Home redirect works again
//  - when nobody is using the remote (window not focused, Remote Mode off,
//    no presses for 2 min) monkey is closed entirely to free its ~85 MB
//
// A supervisor also watches for a stuck connection (no replies for 3s) and
// restarts with backoff (2s, 5s, 12s ... 30s), never on every key press.

const { spawn } = require('child_process');
const net = require('net');
const { state, send } = require('./state');
const { ADB, adb, shell, slowRun } = require('./adb');
const { findReplacementLauncher } = require('./launcher');

const MONKEY_DEVICE_PORT = 1080;
const MONKEY_LOCAL_PORT = 18080;
const MONKEY_STUCK_MS = 3000;      // no reply this long = stuck
const MONKEY_WARMUP_MS = 2500;     // monkey needs ~1-3s after start before it accepts
const IDLE_RELEASE_MS = 15000;     // release UI Automation after this much remote idle
const REMOTE_SLEEP_MS = 2 * 60000; // close monkey entirely after this much disuse
const MAX_QUEUED_KEYS = 20;

// Fire TV remote buttons -> Android keyevent numbers
const KEYS = {
  up: 19, down: 20, left: 21, right: 22, ok: 23,
  back: 4, home: 3, menu: 82,
  playpause: 85, rewind: 89, forward: 90,
  volup: 24, voldown: 25, mute: 164,
  sleep: 223, wake: 224, apps: 187,
};
const KEYCODE_HOME = 3;
const KEYCODE_SPACE = 62;

let monkeyProc = null;     // the "adb shell monkey --port" process
let monkeyReadyAt = 0;     // when the warm monkey should be accepting connections
let monkeyReleasing = false;
let monkeySock = null;     // socket to monkey (only while the remote is in use)
let connecting = null;     // pending connect promise
let pendingKeys = [];      // { line, slow } pressed while connecting
let awaiting = 0;          // commands sent that haven't been answered yet
let oldestPendingAt = 0;   // when the oldest unanswered command was sent
let retryDelay = 0;
let nextRetryAt = 0;
let linkState = '';        // 'fast' | 'slow' | 'down' | 'off', reported to the window

function setLink(s) {
  if (s === linkState) return;
  linkState = s;
  send('remote-link', s);
}

const procAlive = () => !!monkeyProc && monkeyProc.exitCode === null;
const monkeyWarm = () => procAlive() && Date.now() >= monkeyReadyAt;

function monkeyHealthy() {
  if (!monkeySock || monkeySock.destroyed) return false;
  return !(awaiting > 0 && Date.now() - oldestPendingAt > 1500);
}

function monkeySend(line) {
  if (awaiting === 0) oldestPendingAt = Date.now();
  awaiting++;
  monkeySock.write(line + '\n');
}

function tryMonkeySocket() {
  return new Promise((resolve) => {
    const s = net.connect(MONKEY_LOCAL_PORT, '127.0.0.1');
    let buf = '';
    const fail = () => { s.destroy(); resolve(null); };
    const t = setTimeout(fail, 1500);
    s.on('error', () => { clearTimeout(t); resolve(null); });
    s.on('connect', () => s.write('getvar build.version.sdk\n')); // harmless ping
    s.on('data', (d) => {
      buf += d;
      if (!buf.includes('\n')) return;
      clearTimeout(t);
      if (!buf.startsWith('OK')) return fail();
      // Connected and answering. From now on, count replies.
      s.removeAllListeners('data');
      s.removeAllListeners('error');
      s.on('error', () => {});
      s.on('data', (chunk) => {
        const replies = (String(chunk).match(/\n/g) || []).length;
        awaiting = Math.max(0, awaiting - replies);
        oldestPendingAt = awaiting ? Date.now() : 0;
      });
      s.on('close', () => { if (monkeySock === s) monkeySock = null; });
      awaiting = 0; oldestPendingAt = 0;
      resolve(s);
    });
  });
}

function scheduleRetry() {
  retryDelay = retryDelay ? Math.min(Math.round(retryDelay * 2.5), 30000) : 2000;
  nextRetryAt = Date.now() + retryDelay;
}

function resetRetry() { retryDelay = 0; nextRetryAt = 0; }

// Start a monkey on the Fire Stick but don't connect to it.
async function warmMonkey() {
  if (procAlive()) return;
  const p = spawn(ADB, ['-s', state.fireIp, 'shell', 'monkey', '--port', String(MONKEY_DEVICE_PORT)],
    { windowsHide: true });
  const startedAt = Date.now();
  p.on('exit', () => {
    if (monkeyProc !== p) return;
    monkeyProc = null;
    // Died on its own soon after starting (not released by us): back off.
    if (!monkeyReleasing && Date.now() - startedAt < 10000) scheduleRetry();
  });
  p.on('error', () => { if (monkeyProc === p) { monkeyProc = null; scheduleRetry(); } });
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  monkeyProc = p;
  monkeyReadyAt = Date.now() + MONKEY_WARMUP_MS;
  await adb(['-s', state.fireIp, 'forward', 'tcp:' + MONKEY_LOCAL_PORT, 'tcp:' + MONKEY_DEVICE_PORT], 4000);
}

// Connect to the warm monkey (first key press after a pause), then send
// whatever was pressed meanwhile, in order.
function connectMonkey() {
  if (connecting) return connecting;
  connecting = (async () => {
    const s = monkeyWarm() ? await tryMonkeySocket() : null;
    if (s) { monkeySock = s; resetRetry(); }
    else { await stopMonkey(); scheduleRetry(); }   // warm monkey was broken: restart later
    const keys = pendingKeys; pendingKeys = [];
    for (const k of keys) {
      if (monkeyHealthy()) { try { monkeySend(k.line); continue; } catch (e) {} }
      slowRun(k.slow);
    }
    connecting = null;
    return s;
  })();
  return connecting;
}

// Close the connected monkey so Android re-enables accessibility services
// (Home redirect); the supervisor then starts a fresh unconnected one.
async function releaseMonkey() {
  monkeyReleasing = true;
  try {
    await stopMonkey();
    retryDelay = 0;
    nextRetryAt = Date.now() + 1000;   // give the old one a moment to free the port
  } finally {
    monkeyReleasing = false;
  }
}

// Shut monkey down everywhere: our socket, the adb process, the port
// forward, and any copy still running on the Fire Stick.
async function stopMonkey() {
  const s = monkeySock; monkeySock = null;
  if (s) { try { s.write('quit\n'); } catch (e) {} s.destroy(); }
  const p = monkeyProc; monkeyProc = null;
  if (p) { try { p.kill(); } catch (e) {} }
  awaiting = 0; oldestPendingAt = 0;
  await adb(['-s', state.fireIp, 'forward', '--remove', 'tcp:' + MONKEY_LOCAL_PORT], 3000);
  await shell('for p in $(pidof com.android.commands.monkey); do kill $p; done', 4000);
}

// Keep the warm monkey only while the remote might be used.
function remoteWanted() {
  if (state.remoteMode) return true;
  if (state.win && !state.win.isDestroyed() && state.win.isFocused()) return true;
  return Date.now() - Math.max(state.lastKeyAt, state.lastFocusAt) < REMOTE_SLEEP_MS;
}

let superviseBusy = false;
async function superviseMonkey() {
  if (superviseBusy) return;
  superviseBusy = true;
  try {
    if (state.manualOff) { setLink('off'); return; }
    if (!state.fireUp) { setLink('down'); return; }
    if (monkeySock) {
      if (awaiting > 0 && Date.now() - oldestPendingAt > MONKEY_STUCK_MS) {
        await stopMonkey();          // stuck: clean restart after a short wait
        scheduleRetry();
      } else if (!connecting && Date.now() - state.lastKeyAt > IDLE_RELEASE_MS) {
        await releaseMonkey();       // remote idle: give the Home redirect back
      }
    } else if (!connecting && !procAlive() && Date.now() >= nextRetryAt && remoteWanted()) {
      await warmMonkey();
    } else if (!connecting && procAlive() && !remoteWanted()) {
      await stopMonkey();            // nobody is using the remote: free its ~85 MB
    }
    // While deliberately asleep the remote still works (first press wakes it).
    setLink(monkeyHealthy() || monkeyWarm() || !remoteWanted() ? 'fast' : 'slow');
  } finally {
    superviseBusy = false;
  }
}

// ---- Send through the fast channel when possible ----
// line = monkey command, slow = equivalent shell command for the slow path.
function fastSend(line, slow) {
  state.lastKeyAt = Date.now();
  if (monkeyHealthy()) {
    try { monkeySend(line); return Promise.resolve({ ok: true }); } catch (e) {}
  }
  if (connecting || monkeyWarm()) {             // first press after a pause: connect, then send
    if (pendingKeys.length < MAX_QUEUED_KEYS) pendingKeys.push({ line, slow });
    connectMonkey();
    return Promise.resolve({ ok: true });
  }
  superviseMonkey();                            // asleep or down: wake it for the next press
  return slowRun(slow);                         // this press takes the slow path, never piles up
}

// ---- Home ----
// With the lighter home screen on, pressing Home from the app would connect
// monkey (pausing the Home redirect) and land on Amazon's home, so the
// replacement launcher is opened directly instead.
async function goHome() {
  state.lastKeyAt = Date.now();
  if (!state.replacementHome) state.replacementHome = await findReplacementLauncher();
  if (!state.replacementHome) return fastSend('press ' + KEYCODE_HOME, 'input keyevent ' + KEYCODE_HOME);
  return shell('am start -a android.intent.action.MAIN -c android.intent.category.HOME ' +
    `-n ${state.replacementHome} >/dev/null 2>&1`, 6000);
}

// ---- Send one key (Android keyevent number) ----
function sendKey(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return Promise.resolve({ ok: false, out: 'unknown key' });
  if (n === KEYCODE_HOME && state.launcherSwap && state.fireUp) return goHome();
  return fastSend('press ' + n, 'input keyevent ' + n);
}

// ---- Long-press a key (hold OK = options menu: move / uninstall) ----
// monkey can't send a real long-press (no key-repeat flag), so this uses
// "input keyevent --longpress", which sends the proper held-key events.
function longPress(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return Promise.resolve({ ok: false, out: 'unknown key' });
  state.lastKeyAt = Date.now();
  return slowRun('input keyevent --longpress ' + n);
}

// ---- Type text into a Fire TV search box ----
// Word by word with a Space key between words. Fast path uses monkey's
// "type" command ('"' escaped as \" so monkey doesn't treat it as a quote).
// Slow path wraps each word in single quotes so the Fire Stick's shell can't
// mangle symbols like & ' ( ) ; |.
function sendText(text) {
  const words = String(text).replace(/[\r\n]+/g, ' ').split(' ');
  const q = (w) => "'" + w.replace(/'/g, "'\\''") + "'";
  if (monkeyHealthy() || connecting || monkeyWarm()) {
    words.forEach((w, i) => {
      if (i) fastSend('press ' + KEYCODE_SPACE, 'input keyevent ' + KEYCODE_SPACE);
      if (w) fastSend('type ' + w.replace(/"/g, '\\"'), 'input text ' + q(w));
    });
    return Promise.resolve({ ok: true });
  }
  const parts = [];
  words.forEach((w, i) => {
    if (i) parts.push('input keyevent ' + KEYCODE_SPACE);
    if (w) parts.push('input text ' + q(w));
  });
  return parts.length ? slowRun(parts.join('; ')) : Promise.resolve({ ok: true });
}

module.exports = {
  KEYS, sendKey, longPress, sendText,
  superviseMonkey, stopMonkey, resetRetry, setLink,
};
