// ===== Lighter home screen (launcher swap), sweeper, Fire TV Settings =====
//
// Fire OS 8 won't let Amazon's home screen be disabled, and it also holds the
// Settings menu. So instead:
//  - the Home button is redirected by an accessibility service: the
//    "Home on Fire" helper if installed, otherwise the launcher's own
//    (Projectivy). Only one is enabled; the two fight if both are on.
//  - the replacement is set as preferred home (Fire OS usually ignores this)
//  - Amazon's launcher is closed whenever it's in the background (sweeper)

const { state } = require('./state');
const { shell, parseComponents } = require('./adb');

const AMAZON_HOMES = new Set(['com.amazon.tv.launcher', 'com.amazon.firehomestarter', 'com.amazon.tv.settings.v2']);
const AMAZON_HOME_ACTIVITY = 'com.amazon.tv.launcher/.ui.HomeActivity_vNext';
const HOME_HELPER = 'io.github.toolicious.homeonfire';
const SWEEP_EVERY_MS = 60000;

let lastSweep = null;   // { at, text }

async function findReplacementLauncher() {
  const r = await shell('cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME', 6000);
  return parseComponents(r.out).find((c) => !AMAZON_HOMES.has(c.split('/')[0])) || null;
}

async function a11yServicesFor(pkg) {
  const r = await shell('cmd package query-services --brief -a android.accessibilityservice.AccessibilityService', 6000);
  return parseComponents(r.out).filter((c) => c.startsWith(pkg + '/'));
}

async function getEnabledA11y() {
  const v = (await shell('settings get secure enabled_accessibility_services', 4000)).out.trim();
  return (!v || v === 'null') ? [] : v.split(':').filter(Boolean);
}

async function applyLauncherSwap() {
  const home = await findReplacementLauncher();
  if (!home) return { ok: false, text: 'no replacement launcher installed (install Projectivy Launcher from the Appstore)' };
  const pkg = home.split('/')[0];
  state.replacementHome = home;                 // used by the app's Home button
  const helperServices = await a11yServicesFor(HOME_HELPER);
  const launcherServices = await a11yServicesFor(pkg);
  const useHelper = helperServices.length > 0;
  const services = useHelper ? helperServices : launcherServices;
  const enabled = await getEnabledA11y();
  const base = useHelper ? enabled.filter((c) => !launcherServices.includes(c)) : enabled;
  const want = [...new Set([...base, ...services])];
  const cmds = [];
  if (services.length && want.join(':') !== enabled.join(':')) {
    cmds.push(`settings put secure enabled_accessibility_services ${want.join(':')}`);
  }
  if (services.length) cmds.push('settings put secure accessibility_enabled 1');
  cmds.push(`cmd package set-home-activity --user 0 ${home} >/dev/null 2>&1`);
  cmds.push('am kill com.amazon.tv.launcher');   // background-only kill; no effect if on screen
  const r = await shell(cmds.join('; '), 8000);
  return {
    ok: r.ok, pkg, a11y: services.length > 0,
    text: r.ok ? `using ${pkg}` + (useHelper ? ' (Home redirect by Home on Fire)' :
      services.length ? ' (Home button redirect on)' :
      ' (it has no Home-button redirect service, so Home may still open Amazon\'s screen)') : 'failed to apply',
  };
}

async function undoLauncherSwap() {
  const home = await findReplacementLauncher();
  const cmds = [];
  if (home) {
    const services = [...await a11yServicesFor(home.split('/')[0]), ...await a11yServicesFor(HOME_HELPER)];
    const enabled = await getEnabledA11y();
    const left = enabled.filter((c) => !services.includes(c));
    cmds.push(left.length ? `settings put secure enabled_accessibility_services ${left.join(':')}`
      : 'settings delete secure enabled_accessibility_services');
    if (!left.length) cmds.push('settings put secure accessibility_enabled 0');
  }
  cmds.push(`cmd package set-home-activity --user 0 ${AMAZON_HOME_ACTIVITY} >/dev/null 2>&1`);
  cmds.push('input keyevent 3');   // press Home so Amazon's screen comes back now
  const r = await shell(cmds.join('; '), 10000);
  return { ok: r.ok, text: r.ok ? 'back to Amazon home screen' : 'undo failed' };
}

// ---- Sweeper ----
// Every 60 s while the lighter home screen is on: if Amazon's launcher is NOT
// on screen, close it. Fire TV Settings lives inside Amazon's launcher, so
// when Settings is open it counts as on screen and is left alone.
async function sweepLauncher() {
  if (!state.launcherSwap || !state.fireUp || state.manualOff) return;
  const script =
    'f=$(dumpsys window 2>/dev/null | grep -m1 mCurrentFocus); ' +
    'case "$f" in *com.amazon.tv.launcher/*) echo FG;; *) ' +
      'kb=$(ps -A -o RSS,NAME | grep " com.amazon.tv.launcher$" | awk \'{print $1}\'); ' +
      'if [ -z "$kb" ]; then echo NOTRUNNING; else am kill com.amazon.tv.launcher; sleep 1; ' +
      'if pidof com.amazon.tv.launcher >/dev/null; then echo "KEPT $kb"; else echo "KILLED $kb"; fi; fi;; esac';
  const r = await shell(script, 8000);
  const out = r.out.trim();
  const mbOf = (s) => Math.round(Number((s.match(/(\d+)/) || [])[1] || 0) / 1024);
  let text;
  if (!r.ok) text = 'check failed';
  else if (out.startsWith('FG')) text = 'Amazon home is on screen, left it alone';
  else if (out.startsWith('NOTRUNNING')) text = 'Amazon home not running';
  else if (out.startsWith('KILLED')) text = `closed Amazon home (freed ~${mbOf(out)} MB)`;
  else if (out.startsWith('KEPT')) text = 'Fire OS kept Amazon home running';
  else text = 'unknown result';
  lastSweep = { at: new Date().toLocaleTimeString(), text };
}

const getLastSweep = () => lastSweep;

// Fire TV Settings (the replacement launcher owns Home, so this gives a
// reliable way into Settings).
function openFireSettings() {
  return shell('am start -n com.amazon.tv.launcher/.ui.MainSettingsActivity >/dev/null 2>&1 || ' +
    'am start -a android.settings.SETTINGS', 6000);
}

module.exports = {
  SWEEP_EVERY_MS, findReplacementLauncher, applyLauncherSwap, undoLauncherSwap,
  sweepLauncher, getLastSweep, openFireSettings,
};
