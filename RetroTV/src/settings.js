// ===== Settings (saved to settings.json in Electron's user-data folder) =====
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { state } = require('./state');

function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }

// fire-ip.txt in the project folder holds just the IP, shared with the
// helper scripts in ..\scripts.
const IP_FILE = require('./paths').projectFile('fire-ip.txt');
function readIpFile() {
  try { return fs.readFileSync(IP_FILE, 'utf8').trim(); } catch (e) { return ''; }
}
function writeIpFile() {
  try { fs.writeFileSync(IP_FILE, state.fireIp.replace(/:5555$/, '')); } catch (e) {}
}

// "192.168.0.5" -> "192.168.0.5:5555"; returns null if it doesn't look like an address.
function normalizeIp(s) {
  s = String(s || '').trim();
  if (!s) return null;
  if (!/:\d+$/.test(s)) s += ':5555';
  return /^[A-Za-z0-9.\-]+:\d{1,5}$/.test(s) ? s : null;
}

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (s.fireIp && normalizeIp(s.fireIp)) state.fireIp = normalizeIp(s.fireIp);
    if (typeof s.autoDebloat === 'boolean') state.autoDebloat = s.autoDebloat;
    if (typeof s.remoteOff === 'boolean') state.remoteOff = s.remoteOff;
    if (typeof s.launcherSwap === 'boolean') state.launcherSwap = s.launcherSwap;
  } catch (e) { /* first run or unreadable: keep defaults */ }
  // No address saved yet: use the scripts' fire-ip.txt if there is one.
  if (!state.fireIp && normalizeIp(readIpFile())) state.fireIp = normalizeIp(readIpFile());
  if (state.fireIp) writeIpFile();   // keep the scripts in sync
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({
      fireIp: state.fireIp, autoDebloat: state.autoDebloat, launcherSwap: state.launcherSwap, remoteOff: state.remoteOff,
    }, null, 2));
  } catch (e) {}
  if (state.fireIp) writeIpFile();
}

module.exports = { normalizeIp, loadSettings, saveSettings };
