// ===== Auto debloat =====
// Without root, Fire OS can turn Amazon's apps back on (at reboots / via the
// updater). Each time the app connects (app opened, or the Fire Stick
// rebooted) it turns off whatever on debloat-list.txt is on. Uses
// "cmd package" (fast, no Java startup) and only touches apps that are on.
// The list is shared with the scripts in ..\scripts.

const path = require('path');
const fs = require('fs');
const { state, send } = require('./state');
const { shell, parsePkgs } = require('./adb');
const { applyLauncherSwap } = require('./launcher');
const { MAX_CACHED, optimizeRam } = require('./ram');

const APP_DIR = path.join(__dirname, '..');

function debloatListFile() {
  const guesses = [path.join(APP_DIR, '..', 'debloat-list.txt'), path.join(APP_DIR, 'debloat-list.txt')];
  return guesses.find((g) => fs.existsSync(g)) || guesses[0];
}
function debloatLogFile() { return path.join(path.dirname(debloatListFile()), 'auto-debloat-log.txt'); }

function readDebloatList() {
  try {
    return fs.readFileSync(debloatListFile(), 'utf8').split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim())
      .filter((l) => /^[A-Za-z0-9_.]+$/.test(l));   // package names only
  } catch (e) { return []; }
}

let debloatBusy = false;
let lastDebloat = null;   // last result, for the window

function report(r) { lastDebloat = r; send('debloat-status', r); return r; }

function writeLog(result, reason) {
  try {
    fs.writeFileSync(debloatLogFile(), [
      `Auto debloat - ${result.at} (${reason})`,
      `Fire Stick: ${state.fireIp}`,
      `In list: ${result.total} | already off: ${result.already} | not installed: ${result.missing}`,
      `Turned off now (${result.turnedOff.length}):`, ...result.turnedOff.map((p) => '  ' + p),
      `Protected, so suspended + blocked from background instead (${result.suspended.length}):`,
      ...result.suspended.map((p) => '  ' + p),
      `Could not stop at all (${result.failed.length}):`, ...result.failed.map((p) => '  ' + p),
      `Cached-app limit: Fire OS is using ${result.ram.liveMaxCached || '?'}` +
        (result.ram.cacheLimitWorks ? ' (limit active)' : ' (limit ignored; cleaning up every 5 min instead)'),
      `RAM: ${result.ram.ok ? `settings applied (max ${MAX_CACHED} cached apps, animations off), ` +
        `cleared cached apps: ${result.ram.beforeMB} MB -> ${result.ram.afterMB} MB free` : 'could not apply'}`,
      `Launcher swap: ${result.launcher ? result.launcher.text : 'off'}`,
      '',
    ].join('\r\n'));
  } catch (e) {}
}

async function runDebloat(reason) {
  if (debloatBusy || !state.fireUp) return lastDebloat;
  debloatBusy = true;
  report({ running: true, reason });
  try {
    const list = readDebloatList();
    if (!list.length) return report({ error: 'debloat-list.txt is missing or empty' });
    const all = await shell('cmd package list packages --user 0', 8000);
    const dis = await shell('cmd package list packages -d --user 0', 8000);
    if (!all.ok) return report({ error: 'Could not read the app list from the Fire Stick' });
    const installed = parsePkgs(all.out), disabled = parsePkgs(dis.out);
    const targets = list.filter((p) => installed.has(p) && !disabled.has(p));
    const result = {
      reason, at: new Date().toLocaleString(), total: list.length,
      already: list.filter((p) => disabled.has(p)).length,
      missing: list.filter((p) => !installed.has(p)).length,
      turnedOff: [], suspended: [], failed: [],
    };

    if (targets.length) {
      // One shell call for the whole batch; each line reports per app:
      //   OK   = turned off (disable-user)
      //   SUSP = protected from being turned off, so suspended (frozen) and
      //          blocked from running in the background instead
      //   FAIL = nothing worked
      const script = 'for p in ' + targets.join(' ') + '; do ' +
        'if cmd package disable-user --user 0 $p >/dev/null 2>&1; then echo "OK $p"; ' +
        'elif cmd package suspend --user 0 $p >/dev/null 2>&1; then ' +
          'cmd appops set $p RUN_IN_BACKGROUND ignore >/dev/null 2>&1; ' +
          'cmd appops set $p RUN_ANY_IN_BACKGROUND ignore >/dev/null 2>&1; echo "SUSP $p"; ' +
        'else echo "FAIL $p"; fi; done';
      const r = await shell(script, 60000);
      for (const line of r.out.split(/\r?\n/)) {
        const m = line.trim().match(/^(OK|SUSP|FAIL) (\S+)$/);
        if (m) ({ OK: result.turnedOff, SUSP: result.suspended, FAIL: result.failed })[m[1]].push(m[2]);
      }
      // Anything that didn't report back counts as failed.
      const seen = new Set([...result.turnedOff, ...result.suspended, ...result.failed]);
      for (const p of targets) if (!seen.has(p)) result.failed.push(p);
    }

    // Launcher swap first (so Amazon's home goes to the background), then
    // the RAM settings + clearing cached apps.
    if (state.launcherSwap) result.launcher = await applyLauncherSwap();
    result.ram = await optimizeRam();

    writeLog(result, reason);
    return report(result);
  } finally {
    debloatBusy = false;
  }
}

// Run on the first connect and whenever the Fire Stick has rebooted (its
// boot id changes on every boot).
async function maybeAutoDebloat() {
  if (!state.autoDebloat || !state.fireUp) return;
  const r = await shell('cat /proc/sys/kernel/random/boot_id', 4000);
  const bootId = r.ok ? r.out.trim() : '';
  if (!bootId || bootId === state.lastBootId) return;
  const reason = state.lastBootId ? 'Fire Stick rebooted' : 'app opened';
  state.lastBootId = bootId;
  runDebloat(reason);
}

const getLastDebloat = () => lastDebloat;

module.exports = { runDebloat, maybeAutoDebloat, getLastDebloat };
