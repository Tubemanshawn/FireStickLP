// ===== Where the app's companion files live =====
// The app needs files that sit outside its code: platform-tools\adb.exe,
// debloat-list.txt, fire-ip.txt and auto-debloat-log.txt.
//
//   From source:   I:\firestick\RetroTV\src\..\..         -> I:\firestick
//   Built app:     <folder with "Retro TV.exe">, or the folder above it.
//                  Inside the project (I:\firestick\RetroTV-app) the
//                  project's files are used, so the app and the helper
//                  scripts share one debloat list and IP file; copied
//                  anywhere else, the built folder's own copies are used.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const has = (dir, name) => fs.existsSync(path.join(dir, name));

function findProjectDir() {
  if (!app || !app.isPackaged) return path.join(__dirname, '..', '..');
  const exeDir = path.dirname(process.execPath);
  const parent = path.join(exeDir, '..');
  if (has(parent, 'debloat-list.txt')) return parent;
  return exeDir;
}

const PROJECT_DIR = findProjectDir();

module.exports = {
  PROJECT_DIR,
  projectFile: (...parts) => path.join(PROJECT_DIR, ...parts),
};
