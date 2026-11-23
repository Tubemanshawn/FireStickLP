// ===== Retro TV window logic =====
const $ = (id) => document.getElementById(id);
const video = $('video'), osd = $('osd'), msg = $('msg');
let stream = null, started = false, listen = false, osdT = null;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};
function say(t) { msg.textContent = t; }
function showOsd(t, ms = 1600) {
  osd.textContent = t; osd.classList.add('show');
  clearTimeout(osdT); if (ms) osdT = setTimeout(() => osd.classList.remove('show'), ms);
}

// ---------- Capture card ----------
function fill(sel, list, want) {
  sel.innerHTML = '';
  list.forEach((d, i) => sel.add(new Option(d.label || d.kind + ' ' + (i + 1), d.deviceId)));
  if (want && list.some((d) => d.deviceId === want)) sel.value = want;
}
function guessAudio(mics) {
  const p = /usb3? video|capture|hdmi|digital audio interface|cam link|elgato|ezcap|avermedia|ms2109/i;
  const hit = mics.find((d) => p.test(d.label));
  return hit ? hit.deviceId : null;
}
async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  const mics = all.filter((d) => d.kind === 'audioinput');
  fill($('cam'), all.filter((d) => d.kind === 'videoinput'), store.get('cam'));
  fill($('aud'), mics, store.get('aud') || guessAudio(mics));
  fill($('out'), all.filter((d) => d.kind === 'audiooutput'), store.get('out'));
  $('out').disabled = !('setSinkId' in HTMLMediaElement.prototype);
}
async function openCard() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: $('cam').value ? { exact: $('cam').value } : undefined,
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      audio: { deviceId: $('aud').value ? { exact: $('aud').value } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) { showOsd('NO SIGNAL', 0); say('Could not open capture card: ' + e.message); return; }
  video.srcObject = stream;
  await video.play().catch(() => {});
  await applyOutput();
  showOsd('LIVE');
}
async function applyOutput() {
  if (!$('out').value || !video.setSinkId) return;
  try { await video.setSinkId($('out').value); } catch (e) { say('Speaker switch failed: ' + e.message); }
}

// ---------- First start ----------
async function boot() {
  if (started) return; started = true;
  showOsd('STARTING…', 0);
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) { showOsd('ALLOW CAMERA', 0); say('Allow camera access, then reopen.'); started = false; return; }
  await listDevices();
  await openCard();
}
document.addEventListener('click', boot, { once: true });
navigator.mediaDevices.addEventListener('devicechange', listDevices);

// ---------- Listen / PiP ----------
function setListen(on) {
  listen = on; video.muted = !on;
  const b = $('listenBtn');
  b.textContent = on ? '🔊 Listen: ON' : '🔇 Listen: OFF';
  b.classList.toggle('on', on);
}
$('listenBtn').onclick = () => setListen(!listen);

// ---------- Volume (Retro TV's own sound) ----------
// The Fire Stick's HDMI volume is fixed at full (its volume keys only ask the
// TV to change volume over HDMI, which a capture card ignores), so every
// volume control in the app changes the sound played here instead.
const VOL_STEP = 5;
let vol = Math.min(100, Math.max(0, parseInt(store.get('vol') ?? '100', 10) || 0));
video.volume = vol / 100;
function changeVol(delta) {
  vol = Math.min(100, Math.max(0, vol + delta));
  video.volume = vol / 100;
  store.set('vol', String(vol));
  if (delta > 0 && !listen) setListen(true);   // turning it up should be heard
  const text = listen ? `VOL ${vol}%` : `VOL ${vol}% (Listen OFF)`;
  showOsd(text);
  window.fire.pipVolShow(text);
  return vol;
}
window.fire.onVol((delta) => changeVol(delta));   // from the mini window
// Remote buttons go through here so Vol +/- change this sound.
function press(k) {
  if (k === 'volup') return changeVol(VOL_STEP);
  if (k === 'voldown') return changeVol(-VOL_STEP);
  return window.fire.key(k);
}
// Pop out = Retro TV's own mini window (scroll = volume, click = OK,
// right-click = Back). Sound keeps coming from this window.
$('pipBtn').onclick = () => window.fire.pipToggle($('cam').value);
window.fire.onPip((open) => {
  $('pipBtn').textContent = open ? '⧉ Close mini' : '⧉ Pop out';
  $('pipBtn').classList.toggle('on', open);
});

// ---------- Device pickers + effects ----------
$('cam').onchange = () => { store.set('cam', $('cam').value); openCard(); };
$('aud').onchange = () => { store.set('aud', $('aud').value); openCard(); };
$('out').onchange = () => { store.set('out', $('out').value); applyOutput(); };
// ---------- Look: skin + effects (saved, and shared with the mini window) ----------
const SKINS = ['plain', 'wood', 'silver', 'black', 'portable'];
const FX = ['scan', 'curve', 'bw', 'warm'];
const look = (() => {
  try {
    const s = JSON.parse(store.get('look') || '');
    return { skin: SKINS.includes(s.skin) ? s.skin : 'plain', fx: (s.fx || []).filter((f) => FX.includes(f)) };
  } catch (e) { return { skin: 'plain', fx: ['scan', 'curve'] }; }   // first run
})();
function applyLook() {
  const b = document.body;
  SKINS.forEach((s) => b.classList.toggle('skin-' + s, s === look.skin));
  FX.forEach((f) => b.classList.toggle('fx-' + f, look.fx.includes(f)));
  document.querySelectorAll('[data-fx]').forEach((btn) => btn.classList.toggle('on', look.fx.includes(btn.dataset.fx)));
  $('skin').value = look.skin;
  store.set('look', JSON.stringify(look));
  window.fire.lookSet({ ...look, up: fireUp });
}
let fireUp = false;
document.querySelectorAll('[data-fx]').forEach((btn) => {
  btn.onclick = () => {
    const f = btn.dataset.fx;
    look.fx = look.fx.includes(f) ? look.fx.filter((x) => x !== f) : [...look.fx, f];
    applyLook();
  };
});
$('skin').onchange = () => { look.skin = $('skin').value; applyLook(); };
applyLook();

// ---------- Fire Stick remote ----------
// On-screen buttons. Arrows, volume and rewind/forward repeat while held,
// like the real remote: one press right away, then repeats after a pause.
const REPEAT_KEYS = new Set(['up', 'down', 'left', 'right', 'volup', 'voldown', 'rewind', 'forward']);
const REPEAT_DELAY = 400, REPEAT_EVERY = 110;
let holdTimer = null;
function stopHold() { clearTimeout(holdTimer); clearInterval(holdTimer); holdTimer = null; }
// Hold OK = long-press, like the real remote (options menu: move / uninstall).
// A quick tap sends OK when released; holding past LONG_PRESS_MS sends one
// long-press instead (no OK spam while held).
const LONG_PRESS_MS = 500;
function makeOkHold() {
  let timer = null;
  return {
    down() {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; window.fire.longPress('ok'); showOsd('OPTIONS'); }, LONG_PRESS_MS);
    },
    up() { if (timer) { clearTimeout(timer); timer = null; window.fire.key('ok'); } },
    cancel() { clearTimeout(timer); timer = null; },
  };
}
const okButtonHold = makeOkHold(), screenHold = makeOkHold(), enterHold = makeOkHold();
window.addEventListener('blur', () => { okButtonHold.cancel(); screenHold.cancel(); enterHold.cancel(); });

document.querySelectorAll('[data-k]').forEach((b) => {
  const k = b.dataset.k;
  if (k === 'ok') {
    b.addEventListener('pointerdown', (e) => { if (e.button === 0) okButtonHold.down(); });
    b.addEventListener('pointerup', () => okButtonHold.up());
    ['pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => okButtonHold.cancel()));
    return;
  }
  if (!REPEAT_KEYS.has(k)) { b.onclick = () => window.fire.key(k); return; }
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stopHold();
    press(k);
    holdTimer = setTimeout(() => {
      holdTimer = setInterval(() => press(k), REPEAT_EVERY);
    }, REPEAT_DELAY);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stopHold));
});
window.addEventListener('blur', stopHold);

// ---------- Tabs: Controls / System ----------
let sysTimer = null;
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.id !== 'pane-' + t.dataset.tab; });
    clearInterval(sysTimer); sysTimer = null;
    if (t.dataset.tab === 'system') { refreshSys(); sysTimer = setInterval(refreshSys, 3000); }
  };
});

// ---------- System tab: RAM + running apps ----------
const mb = (kb) => Math.round(kb / 1024);
function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return (d ? d + 'd ' : '') + h + 'h ' + m + 'm';
}
let sysBusy = false;
async function refreshSys() {
  if (sysBusy) return;            // never stack requests if the Fire Stick is slow
  sysBusy = true;
  try {
    const s = await window.fire.sysStats();
    if (s.error) { $('sysMsg').textContent = s.error; return; }
    $('sysMsg').textContent = '';
    const used = s.memTotal - s.memAvail, pct = s.memTotal ? Math.round(used / s.memTotal * 100) : 0;
    const bar = $('ramBar');
    bar.style.width = pct + '%';
    bar.classList.toggle('warn', pct >= 75 && pct < 90);
    bar.classList.toggle('high', pct >= 90);
    $('ramText').textContent = `Used ${mb(used)} MB of ${mb(s.memTotal)} MB (${pct}%) · ${mb(s.memAvail)} MB free` +
      (pct < 50 ? ' ✓ under 50%' : ' · target under 50%');
    $('swapText').title = '';
    $('uptimeText').title = s.cacheLimitWorks ? 'Cached-app limit active (max 8)'
      : 'Fire OS ignores the cached-app limit; cleaning up every 5 min' +
        (s.lastCleanup ? ` (last ${s.lastCleanup.at}: ${s.lastCleanup.beforeMB} → ${s.lastCleanup.afterMB} MB free)` : '');
    $('swapText').textContent = s.swapTotal
      ? `Swap: ${mb(s.swapTotal - s.swapFree)} MB of ${mb(s.swapTotal)} MB used` : '';
    $('uptimeText').textContent = 'Fire Stick on for ' + fmtUptime(s.uptime);
    $('sweepText').textContent = s.sweep ? `Sweeper (${s.sweep.at}): ${s.sweep.text}`
      : (launcherOn ? 'Sweeper: first check within a minute' : '');

    $('appCount').textContent = `(${s.apps.length})`;
    const list = $('appList');
    list.replaceChildren(...s.apps.map((a) => {
      const row = document.createElement('div');
      row.className = 'app' + (a.mine ? ' mine' : '') + (a.front ? ' front' : '');
      const name = document.createElement('span');
      name.className = 'name';
      const label = a.pkg === 'com.android.commands.monkey' ? 'Retro TV remote helper (monkey)' : a.pkg;
      name.textContent = (a.front ? '▶ ' : '') + label;
      name.title = a.pkg + (a.procs > 1 ? ` (${a.procs} processes)` : '');
      const memEl = document.createElement('span');
      memEl.className = 'mem';
      memEl.textContent = mb(a.kb) + ' MB';
      row.append(name, memEl);
      if (a.mine) {
        const b = document.createElement('button');
        b.textContent = 'Stop';
        b.title = 'Force-stop ' + a.pkg;
        b.onclick = async () => {
          b.disabled = true;
          const r = await window.fire.stopApp(a.pkg);
          $('sysMsg').textContent = r.ok ? 'Stopped ' + a.pkg : (r.error || 'Stop failed');
          refreshSys();
        };
        row.append(b);
      }
      return row;
    }));
  } finally {
    sysBusy = false;
  }
}

// Free RAM button
$('freeRamBtn').onclick = async () => {
  const b = $('freeRamBtn'); b.disabled = true; $('freeRamText').textContent = 'Clearing cached apps…';
  const r = await window.fire.freeRam();
  $('freeRamText').textContent = r.ok
    ? `Free RAM: ${r.beforeMB} MB → ${r.afterMB} MB (${r.afterMB - r.beforeMB >= 0 ? '+' : ''}${r.afterMB - r.beforeMB} MB)`
    : 'Could not clear (Fire Stick not connected?)';
  b.disabled = false; refreshSys();
};

// Lighter home screen (launcher swap)
let launcherOn = false;
function showLauncher(on, text) {
  launcherOn = on;
  $('launcherBtn').textContent = 'Lighter home screen: ' + (on ? 'ON' : 'OFF');
  $('launcherBtn').classList.toggle('on', on);
  if (text) $('launcherText').textContent = text;
}
window.fire.launcherGet().then((s) => showLauncher(s.on));
$('launcherBtn').onclick = async () => {
  $('launcherBtn').disabled = true;
  const r = await window.fire.launcherSet(!launcherOn);
  showLauncher(r.on, r.text ? (r.on ? 'Launcher: ' : '') + r.text : '');
  $('launcherBtn').disabled = false;
};

// Fire TV Settings shortcut (works even when a new launcher owns Home)
$('settingsBtn').onclick = () => window.fire.openSettings();

// Debloat: auto toggle, manual button, last result
function showDebloat(r) {
  if (!r) return;
  const info = $('debloatInfo');
  if (r.running) { info.textContent = 'Debloating…'; return; }
  if (r.error) { info.textContent = 'Debloat: ' + r.error; return; }
  const parts = [];
  const susp = r.suspended || [];
  parts.push(r.turnedOff.length ? `Turned off ${r.turnedOff.length} app(s)` : 'Nothing had come back');
  if (susp.length) parts.push(`${susp.length} protected app(s) suspended`);
  if (r.already) parts.push(`${r.already} already off`);
  if (r.failed.length) parts.push(`${r.failed.length} couldn't be stopped`);
  if (r.ram && r.ram.ok) parts.push(`free RAM ${r.ram.beforeMB} → ${r.ram.afterMB} MB`);
  if (r.launcher) parts.push('launcher: ' + r.launcher.text);
  info.textContent = `Debloat (${r.reason}, ${r.at}): ${parts.join(', ')}.`;
  const tip = [];
  if (susp.length) tip.push('Suspended (Fire OS protects these from being turned off):\n' + susp.join('\n'));
  if (r.failed.length) tip.push('Could not stop:\n' + r.failed.join('\n'));
  info.title = tip.join('\n\n');
  if (r.turnedOff.length) showOsd(`DEBLOATED ${r.turnedOff.length} APPS`);
}
function showDebloatAuto(on) {
  $('debloatAuto').textContent = on ? 'Auto: ON' : 'Auto: OFF';
  $('debloatAuto').classList.toggle('on', on);
}
let debloatAutoOn = true;
window.fire.debloatGet().then((s) => { debloatAutoOn = s.auto; showDebloatAuto(s.auto); showDebloat(s.last); });
window.fire.onDebloat(showDebloat);
$('debloatAuto').onclick = async () => { debloatAutoOn = await window.fire.debloatAuto(!debloatAutoOn); showDebloatAuto(debloatAutoOn); };
$('debloatNow').onclick = () => window.fire.debloatNow();

// Streamer mode: hides the Fire Stick's IP on screen (the box shows dots,
// messages don't name the address). Saved. Typing a new address still works.
let streamer = store.get('streamer') === '1';
function applyStreamer() {
  $('ipBox').type = streamer ? 'password' : 'text';
  $('streamerBtn').classList.toggle('on', streamer);
  $('streamerBtn').textContent = streamer ? '🎥 Streamer: ON' : '🎥 Streamer';
  if (streamer && /\d+\.\d+\.\d+\.\d+/.test(msg.textContent)) say('');   // clear a message showing the IP
  store.set('streamer', streamer ? '1' : '0');
}
$('streamerBtn').onclick = () => { streamer = !streamer; applyStreamer(); };
applyStreamer();

// Fire Stick address: load saved value, Connect / Disconnect
window.fire.config().then((c) => {
  $('ipBox').value = c.ip.replace(/:5555$/, '');
  if (!c.ip) say('First run: type your Fire Stick\'s IP under "Fire Stick address" and press Connect.');
});
async function connectIp() {
  say('Connecting…');
  const r = await window.fire.setIp($('ipBox').value);
  if (!r.ok) return say(r.error);
  if (r.remoteOff) { $('ipBox').value = r.ip.replace(/:5555$/, ''); return say('Address saved. PC remote is OFF: turn it on to connect.'); }
  $('ipBox').value = r.ip.replace(/:5555$/, '');
  const where = streamer ? 'your Fire Stick' : r.ip;
  say(r.up ? 'Connected to ' + where : 'Saved ' + (streamer ? 'the address' : r.ip) + ', but the Fire Stick isn\'t answering. Check the address and that ADB Debugging is on.');
}
$('ipConnect').onclick = connectIp;
$('ipBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectIp(); });
$('ipDisconnect').onclick = async () => { await window.fire.disconnect(); say('Disconnected. Press Connect to reconnect.'); };

// Connection status light
window.fire.onStatus((up) => {
  $('statusDot').classList.toggle('up', up);
  document.body.classList.toggle('fire-down', !up);   // the skins' power light
  fireUp = up; window.fire.lookSet({ ...look, up });
});

// Remote link status: fast = normal, slow/down = reconnecting
let linkSeen = false;
window.fire.onLink((state) => {
  if (state === 'fast') { if (linkSeen) showOsd('REMOTE READY'); }
  else if (state === 'off') showOsd('REMOTE DISCONNECTED');
  else showOsd(state === 'down' ? 'FIRE STICK OFFLINE' : 'REMOTE RECONNECTING…', 0);
  linkSeen = true;
});

// Remote Mode button + indicator (toggled here or by the global hotkey)
$('remoteBtn').onclick = () => window.fire.toggleRemote();

// PC remote on/off (saved). Off = this app leaves the Fire Stick alone so the
// phone app or the other PC app can use it. The screen keeps working.
let remoteOff = false;
function showRemoteOff(off) {
  remoteOff = off;
  document.body.classList.toggle('remote-off', off);
  $('pcRemoteBtn').textContent = off ? '📡 PC remote: OFF' : '📡 PC remote: ON';
  $('pcRemoteBtn').classList.toggle('off', off);
}
window.fire.config().then((c) => showRemoteOff(!!c.remoteOff));
$('pcRemoteBtn').onclick = async () => {
  $('pcRemoteBtn').disabled = true;
  showRemoteOff(await window.fire.setRemoteOff(!remoteOff));
  say(remoteOff ? 'PC remote is OFF: this app is leaving the Fire Stick alone (screen still works).' : 'PC remote is ON: reconnecting…');
  showOsd(remoteOff ? 'PC REMOTE OFF' : 'PC REMOTE ON');
  $('pcRemoteBtn').disabled = false;
};
window.fire.onRemoteMode((on) => {
  document.body.classList.toggle('remote', on);
  $('remoteBtn').classList.toggle('on', on);
  showOsd(on ? 'REMOTE MODE ON' : 'REMOTE MODE OFF');
});

// Typing into Fire TV search
$('typeBox').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value) {
    window.fire.text(e.target.value);
    e.target.value = '';
  }
});

// Mouse on the screen: click = OK (hold = long-press), right-click = Back,
// wheel = volume. The very first click only starts the capture card.
const box = $('screenBox');
box.addEventListener('pointerdown', (e) => { if (e.button === 0 && started) screenHold.down(); });
box.addEventListener('pointerup', (e) => { if (e.button === 0) screenHold.up(); });
['pointerleave', 'pointercancel'].forEach((ev) => box.addEventListener(ev, () => screenHold.cancel()));
box.addEventListener('contextmenu', (e) => { e.preventDefault(); window.fire.key('back'); });
$('tvBox').addEventListener('wheel', (e) => {   // whole TV, frame included
  e.preventDefault();
  changeVol(e.deltaY < 0 ? VOL_STEP : -VOL_STEP);
}, { passive: false });

// Keyboard while this window is focused (remote-mode hotkey works anywhere)
// Enter: tap = OK, hold = long-press (same as the OK button).
const typingTarget = (e) => e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
document.addEventListener('keydown', (e) => {
  if (typingTarget(e)) return;
  if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) enterHold.down(); return; }
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Backspace: 'back', Escape: 'back', ' ': 'playpause' };
  if (map[e.key]) { e.preventDefault(); window.fire.key(map[e.key]); }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Enter' && !typingTarget(e)) { e.preventDefault(); enterHold.up(); }
});

setListen(false);
