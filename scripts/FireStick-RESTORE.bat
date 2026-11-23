@echo off
title Fire Stick RESTORE (bring every app back)
set IP=
if exist "%~dp0..\fire-ip.txt" set /p IP=<"%~dp0..\fire-ip.txt"
if not defined IP set /p IP=Fire Stick IP address: 
set DEV=%IP%:5555
set HERE=%~dp0..\
set ADB=%HERE%platform-tools\adb.exe
"%ADB%" connect %DEV%
for /f "usebackq delims=" %%P in ("%HERE%debloat-list.txt") do (
  echo Restoring %%P
  "%ADB%" -s %DEV% shell cmd package install-existing --user 0 %%P
  "%ADB%" -s %DEV% shell pm enable %%P
)
echo Everything is back. Restarting the Stick...
"%ADB%" -s %DEV% reboot
pause
