// ===== adb helpers =====
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { state } = require('./state');
const { projectFile } = require('./paths');

// adb.exe lives in platform-tools in the project folder (see paths.js),
// next to the app code, or on PATH.
function findAdb() {
  const guesses = [
    projectFile('platform-tools', 'adb.exe'),
    path.join(__dirname, '..', 'platform-tools', 'adb.exe'),
  ];
  return guesses.find((g) => fs.existsSync(g)) || 'adb';
}
const ADB = findAdb();

// Run an adb command; resolves with { ok, out }. Never hangs (timeout).
function adb(args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || '') + (stderr || '') });
    });
  });
}

// Run a shell command on the Fire Stick.
function shell(cmd, timeout = 8000) {
  return adb(['-s', state.fireIp, 'shell', cmd], timeout);
}

// ---- Slow path: one adb command per press ----
// Used while the fast monkey channel is down. Runs one at a time, in order,
// each with a timeout; extra presses are dropped instead of piling up.
const SLOW_MAX_QUEUED = 3;
let slowChain = Promise.resolve();
let slowQueued = 0;

function slowRun(cmd) {
  if (slowQueued >= SLOW_MAX_QUEUED) return Promise.resolve({ ok: false, out: 'dropped' });
  slowQueued++;
  const p = slowChain.then(() => shell(cmd, 4000));
  slowChain = p.finally(() => { slowQueued--; });
  return p;
}

// "package:com.x\npackage:com.y" -> Set { com.x, com.y }
const parsePkgs = (out) => new Set(out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean));

// Lines like "com.x/.Activity" from "cmd package query-* --brief"
const parseComponents = (out) => out.split(/\r?\n/).map((l) => l.trim())
  .filter((l) => /^[\w.]+\/[\w.$]+$/.test(l));

// MemAvailable from /proc/meminfo output, in MB
const memFreeMB = (out) => Math.round(Number((out.match(/MemAvailable:\s+(\d+)/) || [])[1] || 0) / 1024);

module.exports = { ADB, adb, shell, slowRun, parsePkgs, parseComponents, memFreeMB };
