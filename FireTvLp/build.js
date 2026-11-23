// ===== Build a standalone "FireTvLp.exe" =====
// Run:  npm run build      (from the FireTvLp folder)
//
// Makes I:\firestick\FireTvLp-app\ (one level up from this folder):
//   FireTvLp.exe            Electron, renamed
//   resources\app\          this app's code
//   platform-tools\         copy of adb (if found next to the project)
//
// Uses the Electron already unpacked in ..\RetroTV\node_modules (no second
// npm install, which would hit the same Node 26 unzip bug).

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const PROJECT = path.join(HERE, '..');
const OUT = path.join(PROJECT, 'FireTvLp-app');
const ELECTRON_DIST = path.join(PROJECT, 'RetroTV', 'node_modules', 'electron', 'dist');
const EXE_NAME = 'FireTvLp.exe';
const APP_FILES = ['main.js', 'preload.js', 'index.html', 'renderer.js', 'package.json', 'src'];

function fail(msg) { console.error('\nBUILD FAILED: ' + msg); process.exit(1); }
function folderSizeMB(dir) {
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    bytes += e.isDirectory() ? folderSizeMB(p) * 1048576 : fs.statSync(p).size;
  }
  return bytes / 1048576;
}

if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  fail('RetroTV\\node_modules\\electron\\dist\\electron.exe is missing. Run RetroTV\\Setup-and-Run.bat once first.');
}
if (fs.existsSync(OUT)) {
  try { fs.rmSync(OUT, { recursive: true, force: true }); }
  catch (e) { fail(`could not delete the old ${OUT}. Close FireTvLp and try again.`); }
}

console.log('Copying Electron...');
fs.cpSync(ELECTRON_DIST, OUT, { recursive: true });
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, EXE_NAME));
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

console.log('Copying app code...');
const appDir = path.join(OUT, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const f of APP_FILES) {
  const src = path.join(HERE, f);
  if (!fs.existsSync(src)) fail('missing app file: ' + f);
  fs.cpSync(src, path.join(appDir, f), { recursive: true });
}

const tools = path.join(PROJECT, 'platform-tools');
if (fs.existsSync(tools)) { fs.cpSync(tools, path.join(OUT, 'platform-tools'), { recursive: true }); console.log('Copied platform-tools'); }

console.log(`\nBuilt FireTvLp B${require('./package.json').version}`);
console.log(`  ${path.join(OUT, EXE_NAME)}`);
console.log(`  ${folderSizeMB(OUT).toFixed(0)} MB`);
