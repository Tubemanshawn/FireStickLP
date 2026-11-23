@echo off
set IP=
if exist "%~dp0..\fire-ip.txt" set /p IP=<"%~dp0..\fire-ip.txt"
if not defined IP set /p IP=Fire Stick IP address: 
set DEV=%IP%:5555
set ADB=%~dp0..\platform-tools\adb.exe
set OUT=%~dp0..\state-check.txt
"%ADB%" connect %DEV% >nul
> "%OUT%" echo ===== DISABLED (user 0) =====
"%ADB%" -s %DEV% shell pm list packages -d --user 0 >> "%OUT%" 2>&1
>> "%OUT%" echo ===== STATE PER APP =====
for /f "usebackq delims=" %%P in ("%~dp0..\debloat-list.txt") do (
  >> "%OUT%" echo --- %%P
  "%ADB%" -s %DEV% shell "dumpsys package %%P | grep -m1 -E 'enabled='" >> "%OUT%" 2>&1
)
