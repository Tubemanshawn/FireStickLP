@echo off
title Fire Stick Scan v2 (read only)
set IP=
if exist "%~dp0..\fire-ip.txt" set /p IP=<"%~dp0..\fire-ip.txt"
if not defined IP set /p IP=Fire Stick IP address: 
set DEV=%IP%:5555
set HERE=%~dp0..\
set ADB=%HERE%platform-tools\adb.exe
set OUT=%HERE%firestick-report.txt

REM ---------- 1. Get ADB if it's missing ----------
if not exist "%ADB%" (
  echo Downloading Google ADB Platform Tools...
  powershell -NoProfile -Command ^
    "Invoke-WebRequest https://dl.google.com/android/repository/platform-tools-latest-windows.zip -OutFile '%HERE%pt.zip';" ^
    "Expand-Archive '%HERE%pt.zip' '%HERE%' -Force; Remove-Item '%HERE%pt.zip'"
)
if not exist "%ADB%" ( echo Could not get ADB. & pause & exit /b )

REM ---------- 2. Test the network first ----------
> "%OUT%" echo ===== PING TEST =====
ping -n 2 %IP% >> "%OUT%" 2>&1

REM ---------- 3. Fresh connect ----------
>> "%OUT%" echo.
>> "%OUT%" echo ===== CONNECT =====
"%ADB%" kill-server >> "%OUT%" 2>&1
"%ADB%" start-server >> "%OUT%" 2>&1
"%ADB%" connect %DEV% >> "%OUT%" 2>&1

echo.
echo ================================================
echo  LOOK AT YOUR TV NOW.
echo  Tick "Always allow from this computer", press OK.
echo  Then come back here and press any key.
echo ================================================
pause

"%ADB%" connect %DEV% >> "%OUT%" 2>&1
>> "%OUT%" echo.
>> "%OUT%" echo ===== DEVICE LIST (should say "device") =====
"%ADB%" devices -l >> "%OUT%" 2>&1

REM ---------- 4. Device info ----------
>> "%OUT%" echo.
>> "%OUT%" echo ===== DEVICE =====
"%ADB%" -s %DEV% shell getprop ro.product.model >> "%OUT%" 2>&1
"%ADB%" -s %DEV% shell getprop ro.build.version.name >> "%OUT%" 2>&1
"%ADB%" -s %DEV% shell getprop ro.build.version.release >> "%OUT%" 2>&1

REM ---------- 5. App lists ----------
>> "%OUT%" echo.
>> "%OUT%" echo ===== ENABLED APPS =====
"%ADB%" -s %DEV% shell pm list packages -e >> "%OUT%" 2>&1
>> "%OUT%" echo.
>> "%OUT%" echo ===== DISABLED APPS =====
"%ADB%" -s %DEV% shell pm list packages -d >> "%OUT%" 2>&1
>> "%OUT%" echo.
>> "%OUT%" echo ===== APPS YOU INSTALLED =====
"%ADB%" -s %DEV% shell pm list packages -3 >> "%OUT%" 2>&1

REM ---------- 6. Storage + memory ----------
>> "%OUT%" echo.
>> "%OUT%" echo ===== STORAGE + MEMORY =====
"%ADB%" -s %DEV% shell df -h /data >> "%OUT%" 2>&1
"%ADB%" -s %DEV% shell "grep -E 'MemTotal|MemAvailable' /proc/meminfo" >> "%OUT%" 2>&1

echo.
echo Done! Send me: %OUT%
start "" notepad "%OUT%"
pause
