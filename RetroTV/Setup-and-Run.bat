@echo off
title Retro TV - Setup and Run
cd /d "%~dp0"

echo ================================================
echo  Retro TV - first run installs Electron (1-2 min)
echo ================================================
echo.

REM ---- 1. Find Node. If missing, use a portable Node zip from Downloads ----
where node >nul 2>&1
if %errorlevel%==0 goto HAVE_NODE

echo Node not found on PATH. Looking for a portable Node zip in Downloads...
set NODEZIP=
for %%Z in ("%USERPROFILE%\Downloads\node-v*-win-x64.zip") do set NODEZIP=%%~fZ
if not defined NODEZIP (
  echo.
  echo Could not find Node, and no node-v*-win-x64.zip in Downloads.
  echo Install Node from https://nodejs.org then run this again.
  pause & exit /b
)
if not exist "%~dp0node\node.exe" (
  powershell -NoProfile -Command "Expand-Archive -Force '%NODEZIP%' '%~dp0node-tmp'"
  for /d %%D in ("%~dp0node-tmp\node-*") do move "%%D" "%~dp0node" >nul
  rmdir /s /q "%~dp0node-tmp" 2>nul
)
set PATH=%~dp0node;%PATH%

:HAVE_NODE
echo Using Node:
node -v

REM ---- 2. Install Electron if needed ----
if not exist "%~dp0node_modules\electron" (
  echo Installing Electron, please wait...
  call npm install
)

REM ---- 3. Make sure electron.exe really got unpacked ----
REM On newer Node versions Electron's installer downloads the zip but silently
REM fails to unpack it (no electron.exe, no error). If that happened, unpack
REM the downloaded zip from Electron's cache with Windows' built-in tar.
set ELECTRON_DIR=%~dp0node_modules\electron
if exist "%ELECTRON_DIR%\dist\electron.exe" goto RUN

echo Electron did not unpack - fixing it...
for /f "usebackq delims=" %%V in (`node -p "require('./node_modules/electron/package.json').version"`) do set EVER=%%V
set EZIP=
for /r "%LOCALAPPDATA%\electron\Cache" %%Z in (electron-v%EVER%-win32-x64.zip) do if exist "%%Z" set EZIP=%%Z
if not defined EZIP (
  echo Could not find electron-v%EVER%-win32-x64.zip in %LOCALAPPDATA%\electron\Cache.
  echo Delete the node_modules folder and run this again.
  pause & exit /b
)
if not exist "%ELECTRON_DIR%\dist" mkdir "%ELECTRON_DIR%\dist"
tar -xf "%EZIP%" -C "%ELECTRON_DIR%\dist"
if exist "%ELECTRON_DIR%\dist\electron.d.ts" move /y "%ELECTRON_DIR%\dist\electron.d.ts" "%ELECTRON_DIR%\electron.d.ts" >nul
powershell -NoProfile -Command "[IO.File]::WriteAllText('%ELECTRON_DIR%\path.txt','electron.exe')"
if not exist "%ELECTRON_DIR%\dist\electron.exe" (
  echo Fix failed. Delete the node_modules folder and run this again.
  pause & exit /b
)
echo Fixed.

REM ---- 4. Run (no console window needed after this) ----
:RUN
echo Starting Retro TV...
start "" "%ELECTRON_DIR%\dist\electron.exe" "%~dp0."
