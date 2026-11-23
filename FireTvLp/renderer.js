// ===== FireTvLp window logic: screen + remote =====
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
$('cam').onchange = () => { store.set('cam', $('cam').value); openCard(); };
$('aud').onchange = () => { store.set('aud', $('aud').value); openCard(); };
$('out').onchange = () => { store.set('out', $('out').value); applyOutput(); };

// First click starts the capture card (camera permission needs a user action).
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

// ---------- Sound ----------
function setListen(on) {
  listen = on; video.muted = !on;
  $('listenBtn').textContent = on ? '🔊 Listen: ON' : '🔇 Listen: OFF';
  $('listenBtn').classList.toggle('on', on);
}
$('listenBtn').onclick = () => setListen(!listen);

// The Fire Stick's HDMI volume is fixed at full (a capture card ignores its
// volume keys), so volume controls change the sound played here.
const VOL_STEP = 5;
let vol = Math.min(100, Math.max(0, parseInt(store.get('vol') ?? '100', 10) || 0));
video.volume = vol / 100;
function changeVol(delta) {
  vol = Math.min(100, Math.max(0, vol + delta));
  video.volume = vol / 100;
  store.set('vol', String(vol));
  if (delta > 0 && !listen) setListen(true);
  showOsd(listen ? `VOL ${vol}%` : `VOL ${vol}% (Listen OFF)`);
}
function press(k) {
  if (k === 'volup') return changeVol(VOL_STEP);
  if (k === 'voldown') return changeVol(-VOL_STEP);
  return window.fire.key(k);
}

// ---------- Remote buttons ----------
// Arrows, volume and rewind/forward repeat while held.
const REPEAT_KEYS = new Set(['up', 'down', 'left', 'right', 'volup', 'voldown', 'rewind', 'forward']);
const REPEAT_DELAY = 400, REPEAT_EVERY = 110;
let holdTimer = null;
function stopHold() { clearTimeout(holdTimer); clearInterval(holdTimer); holdTimer = null; }
// OK: tap = OK, hold = long-press (options menu: move / uninstall).
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
window.addEventListener('blur', () => { okButtonHold.cancel(); screenHold.cancel(); enterHold.cancel(); stopHold(); });

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
    holdTimer = setTimeout(() => { holdTimer = setInterval(() => press(k), REPEAT_EVERY); }, REPEAT_DELAY);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stopHold));
});

// Mouse on the screen: click = OK (hold = long-press), right-click = Back,
// wheel = volume. The very first click only starts the capture card.
const box = $('screenBox');
box.addEventListener('pointerdown', (e) => { if (e.button === 0 && started) screenHold.down(); });
box.addEventListener('pointerup', (e) => { if (e.button === 0) screenHold.up(); });
['pointerleave', 'pointercancel'].forEach((ev) => box.addEventListener(ev, () => screenHold.cancel()));
box.addEventListener('contextmenu', (e) => { e.preventDefault(); window.fire.key('back'); });
box.addEventListener('wheel', (e) => { e.preventDefault(); changeVol(e.deltaY < 0 ? VOL_STEP : -VOL_STEP); }, { passive: false });

// Keyboard while this window is focused. Enter: tap = OK, hold = long-press.
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

// Typing into Fire TV search
$('typeBox').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value) { window.fire.text(e.target.value); e.target.value = ''; }
});

// ---------- Fire Stick address ----------
window.fire.config().then((c) => {
  $('ipBox').value = c.ip.replace(/:5555$/, '');
  $('ver').textContent = c.version;
  if (!c.ip) say('First run: type your Fire Stick\'s IP under "Fire Stick address" and press Connect.');
});
async function connectIp() {
  say('Connecting…');
  const r = await window.fire.setIp($('ipBox').value);
  if (!r.ok) return say(r.error);
  if (r.remoteOff) { $('ipBox').value = r.ip.replace(/:5555$/, ''); return say('Address saved. PC remote is OFF: turn it on to connect.'); }
  $('ipBox').value = r.ip.replace(/:5555$/, '');
  say(r.up ? 'Connected to ' + r.ip : 'Saved ' + r.ip + ', but the Fire Stick isn\'t answering. Check the address and that ADB Debugging is on.');
}
$('ipConnect').onclick = connectIp;
$('ipBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectIp(); });
$('ipDisconnect').onclick = async () => { await window.fire.disconnect(); say('Disconnected. Press Connect to reconnect.'); };

// ---------- Status ----------
window.fire.onStatus((up) => $('statusDot').classList.toggle('up', up));
let linkSeen = false;
window.fire.onLink((s) => {
  if (s === 'fast') { if (linkSeen) showOsd('REMOTE READY'); }
  else if (s === 'off') showOsd('REMOTE DISCONNECTED');
  else showOsd(s === 'down' ? 'FIRE STICK OFFLINE' : 'REMOTE RECONNECTING…', 0);
  linkSeen = true;
});
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

setListen(false);
