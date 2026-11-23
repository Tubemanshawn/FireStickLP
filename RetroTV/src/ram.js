// ===== RAM trimming =====
// - cached-app limit: how many closed apps Android keeps in memory. On
//   Android 11 the live value comes from device_config (namespace
//   activity_manager); the global setting alone is ignored, so both are set
//   and the live value is read back.
// - animations off: a little less GPU/RAM work, snappier menus
// - am kill-all: closes cached background processes (never the app on screen)

const { state } = require('./state');
const { shell, memFreeMB } = require('./adb');

const MAX_CACHED = 8;
const CLEANUP_EVERY_MS = 5 * 60000;
let lastCleanup = null;

async function freeRam() {
  const r = await shell('grep MemAvailable /proc/meminfo; am kill-all; sleep 2; echo @@; grep MemAvailable /proc/meminfo', 10000);
  const [before = '', after = ''] = r.out.split('@@');
  return { ok: r.ok, beforeMB: memFreeMB(before), afterMB: memFreeMB(after) };
}

async function optimizeRam() {
  // Keep any other activity_manager_constants values; only set ours.
  const cur = (await shell('settings get global activity_manager_constants', 4000)).out.trim();
  const keep = (!cur || cur === 'null') ? [] :
    cur.split(',').filter((e) => e && !e.startsWith('max_cached_processes=') && /^[\w.=-]+$/.test(e));
  const consts = [...keep, 'max_cached_processes=' + MAX_CACHED].join(',');
  const r = await shell(
    `settings put global activity_manager_constants ${consts}; ` +
    `device_config put activity_manager max_cached_processes ${MAX_CACHED}; ` +
    'settings put global window_animation_scale 0; ' +
    'settings put global transition_animation_scale 0; ' +
    'settings put global animator_duration_scale 0; ' +
    'sleep 1; dumpsys activity settings | grep CUR_MAX_CACHED_PROCESSES', 8000);
  const live = Number((r.out.match(/CUR_MAX_CACHED_PROCESSES=(\d+)/) || [])[1] || 0);
  state.cacheLimitWorks = live > 0 && live <= MAX_CACHED;
  const freed = await freeRam();
  return { ...freed, ok: r.ok && freed.ok, liveMaxCached: live, cacheLimitWorks: state.cacheLimitWorks };
}

// Backup plan if Fire OS ignores the cached-app limit: clear cached apps
// every 5 minutes.
async function periodicCleanup() {
  if (state.cacheLimitWorks || !state.fireUp || state.manualOff || !state.autoDebloat) return;
  const r = await freeRam();
  if (r.ok) lastCleanup = { at: new Date().toLocaleTimeString(), beforeMB: r.beforeMB, afterMB: r.afterMB };
}

const getLastCleanup = () => lastCleanup;

module.exports = { MAX_CACHED, CLEANUP_EVERY_MS, freeRam, optimizeRam, periodicCleanup, getLastCleanup };
