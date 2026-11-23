@echo off
set IP=
if exist "%~dp0..\fire-ip.txt" set /p IP=<"%~dp0..\fire-ip.txt"
if not defined IP set /p IP=Fire Stick IP address: 
set DEV=%IP%:5555
set ADB=%~dp0..\platform-tools\adb.exe
set OUT=%~dp0..\memory-check.txt
"%ADB%" connect %DEV% >nul
> "%OUT%" echo ===== MEMORY NOW =====
"%ADB%" -s %DEV% shell "grep -E 'MemTotal|MemAvailable' /proc/meminfo" >> "%OUT%" 2>&1
>> "%OUT%" echo ===== UPTIME =====
"%ADB%" -s %DEV% shell uptime >> "%OUT%" 2>&1
>> "%OUT%" echo ===== DISABLED COUNT =====
"%ADB%" -s %DEV% shell "pm list packages -d | wc -l" >> "%OUT%" 2>&1
