// ===== System tab: RAM + running apps =====
// One light adb call per refresh: /proc/meminfo, ps (RSS per process), the
// focused window and uptime. (dumpsys meminfo would be more exact but is
// heavy on a Fire Stick, so it isn't used for a 3-second refresh.)

const { state } = require('./state');
const { shell, parsePkgs } = require('./adb');
const { getLastSweep } = require('./launcher');
const { getLastCleanup } = require('./ram');

let thirdParty = new Set();
let thirdPartyAt = 0;

async function refreshThirdParty() {
  if (Date.now() - thirdPartyAt < 60000) return;
  const r = await shell('cmd package list packages -3 --user 0', 6000);
  if (r.ok) { thirdParty = parsePkgs(r.out); thirdPartyAt = Date.now(); }
}

async function sysStats() {
  if (!state.fireUp) return { error: 'Fire Stick not connected' };
  await refreshThirdParty();
  const SEP = '@@SEP@@';
  const r = await shell(
    `cat /proc/meminfo; echo ${SEP}; ps -A -o USER,RSS,NAME; echo ${SEP}; ` +
    `dumpsys window 2>/dev/null | grep -m1 mCurrentFocus; echo ${SEP}; cat /proc/uptime`, 6000);
  if (!r.ok) return { error: 'Could not read stats from the Fire Stick' };
  const [memTxt = '', psTxt = '', focusTxt = '', upTxt = ''] = r.out.split(SEP);

  const mem = {};
  for (const m of memTxt.matchAll(/^(\w+):\s+(\d+) kB/gm)) mem[m[1]] = Number(m[2]);

  const fg = (focusTxt.match(/ (\S+?)\//) || [])[1] || '';
  const apps = new Map();
  for (const line of psTxt.split(/\r?\n/).slice(1)) {
    const [, rss, name] = line.trim().match(/^\S+\s+(\d+)\s+(\S+)$/) || [];
    if (!name || !/^[A-Za-z][\w]*(\.[\w]+)+(:[\w.]+)?$/.test(name)) continue;  // package-style names only
    const pkg = name.split(':')[0];
    const a = apps.get(pkg) || { pkg, kb: 0, procs: 0 };
    a.kb += Number(rss); a.procs++;
    apps.set(pkg, a);
  }
  const list = [...apps.values()]
    .map((a) => ({ ...a, mine: thirdParty.has(a.pkg), front: a.pkg === fg }))
    .sort((a, b) => b.kb - a.kb);

  return {
    memTotal: mem.MemTotal || 0, memAvail: mem.MemAvailable || 0,
    swapTotal: mem.SwapTotal || 0, swapFree: mem.SwapFree || 0,
    uptime: Number((upTxt.trim().split(/\s+/)[0]) || 0),
    front: fg, apps: list,
    sweep: state.launcherSwap ? getLastSweep() : null,
    cacheLimitWorks: state.cacheLimitWorks, lastCleanup: getLastCleanup(),
  };
}

// Stop button: only for apps the user installed (stopping Amazon's system
// apps can glitch the Fire Stick).
async function stopApp(pkg) {
  if (!/^[A-Za-z][\w.]+$/.test(pkg || '') || !thirdParty.has(pkg)) {
    return { ok: false, error: 'Only apps you installed can be stopped here.' };
  }
  const r = await shell('am force-stop ' + pkg, 6000);
  return { ok: r.ok && !/Exception/.test(r.out), error: r.ok ? '' : 'Stop failed' };
}

module.exports = { sysStats, stopApp };
