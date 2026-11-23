// ===== Fire Stick connection: connect, change address, disconnect =====
const { state, send } = require('./state');
const { adb } = require('./adb');
const { normalizeIp, saveSettings } = require('./settings');
const { superviseMonkey, stopMonkey, resetRetry, setLink } = require('./remote');
const { maybeAutoDebloat } = require('./debloat');

const CHECK_EVERY_MS = 20000;

// Connect (or re-check the connection). Runs every 20 s.
async function connect() {
  // Disconnected on purpose, or no address set yet (first run): don't try.
  if (state.manualOff || !state.fireIp) { send('fire-status', false); return false; }
  await adb(['connect', state.fireIp], 6000);
  const r = await adb(['-s', state.fireIp, 'get-state'], 4000);
  const up = r.out.includes('device');
  if (up && !state.fireUp) { await stopMonkey(); resetRetry(); }   // (re)connected: start fresh
  state.fireUp = up;
  send('fire-status', up);
  superviseMonkey();
  maybeAutoDebloat();
  return up;
}

async function setFireIp(raw) {
  const ip = normalizeIp(raw);
  if (!ip) return { ok: false, error: 'That doesn\'t look like an address. Example: 192.168.1.50' };
  if (ip !== state.fireIp) {
    if (state.fireIp) {                       // tear down the link to the old address
      await stopMonkey();
      await adb(['disconnect', state.fireIp], 4000);
    }
    state.fireIp = ip;
    state.lastBootId = '';                    // different device: debloat it on connect
    state.replacementHome = null;
    saveSettings();
  }
  state.manualOff = false;
  state.fireUp = false;                       // force a fresh start on the new address
  const up = await connect();
  return { ok: true, ip, up };
}

async function disconnectFire() {
  state.manualOff = true;
  state.fireUp = false;
  await stopMonkey();
  await adb(['disconnect', state.fireIp], 4000);
  send('fire-status', false);
  setLink('off');
  return true;
}

module.exports = { CHECK_EVERY_MS, connect, setFireIp, disconnectFire };
