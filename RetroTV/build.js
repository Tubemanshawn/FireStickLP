// ===== Build a standalone "Retro TV.exe" =====
// Run:  npm run build      (from the RetroTV folder)
//
// Makes I:\firestick\RetroTV-app\ (one level up from this folder):
//   Retro TV.exe            Electron, renamed
//   resources\app\          this app's code
//   platform-tools\         copy of adb (if found next to the project)
//   debloat-list.txt        copy of the debloat list
//
// The folder runs on its own: no Node, no node_modules, no npm install.
// It copies the already-unpacked Electron from node_modules instead of
// using electron-packager, whose unzip step is broken on newer Node versions
// (the same bug that stopped electron.exe installing in the first place).

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const PROJECT = path.join(HERE, '..');
const OUT = path.join(PROJECT, 'RetroTV-app');
const ELECTRON_DIST = path.join(HERE, 'node_modules', 'electron', 'dist');
const EXE_NAME = 'Retro TV.exe';

// App files that go into resources\app
const APP_FILES = ['main.js', 'preload.js', 'renderer.html', 'renderer.js', 'pip.html', 'pip.js', 'skins.css', 'package.json', 'src'];

function fail(msg) { console.error('\nBUILD FAILED: ' + msg); process.exit(1); }

function folderSizeMB(dir) {
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    bytes += e.isDirectory() ? folderSizeMB(p) * 1048576 : fs.statSync(p).size;
  }
  return bytes / 1048576;
}

// 1. Check Electron is really there
if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  fail('node_modules\\electron\\dist\\electron.exe is missing. Run Setup-and-Run.bat once first.');
}

// 2. Clear the old build (fails if the built app is running)
if (fs.existsSync(OUT)) {
  try { fs.rmSync(OUT, { recursive: true, force: true }); }
  catch (e) { fail(`could not delete the old ${OUT}. Close Retro TV and try again.`); }
}

// 3. Electron's program files, with the exe renamed
console.log('Copying Electron...');
fs.cpSync(ELECTRON_DIST, OUT, { recursive: true });
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, EXE_NAME));
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

// 4. The app's code
console.log('Copying app code...');
const appDir = path.join(OUT, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const f of APP_FILES) {
  const src = path.join(HERE, f);
  if (!fs.existsSync(src)) fail('missing app file: ' + f);
  fs.cpSync(src, path.join(appDir, f), { recursive: true });
}

// 5. Companion files, so the folder also works when copied elsewhere
const extras = [['platform-tools', 'platform-tools'], ['debloat-list.txt', 'debloat-list.txt']];
for (const [from, to] of extras) {
  const src = path.join(PROJECT, from);
  if (fs.existsSync(src)) { fs.cpSync(src, path.join(OUT, to), { recursive: true }); console.log('Copied ' + from); }
  else console.log(`(skipped ${from}: not found)`);
}

const version = require('./package.json').version;
console.log(`\nBuilt Retro TV ${version}`);
console.log(`  ${path.join(OUT, EXE_NAME)}`);
console.log(`  ${folderSizeMB(OUT).toFixed(0)} MB`);
