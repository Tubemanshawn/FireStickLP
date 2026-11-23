@echo off
title Fire Stick UNDO (turn everything back on)
set IP=
if exist "%~dp0..\fire-ip.txt" set /p IP=<"%~dp0..\fire-ip.txt"
if not defined IP set /p IP=Fire Stick IP address: 
set DEV=%IP%:5555
set HERE=%~dp0..\
set ADB=%HERE%platform-tools\adb.exe
set LIST=%HERE%debloat-list.txt

"%ADB%" connect %DEV%

for /f "usebackq delims=" %%P in ("%LIST%") do (
  echo Turning back on %%P
  "%ADB%" -s %DEV% shell pm enable %%P
)

echo.
echo Everything is back on. Restarting the Stick...
"%ADB%" -s %DEV% reboot
pause
