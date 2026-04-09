@echo off
setlocal enabledelayedexpansion
title Padmavathi Fruits - Generate VAPID Keys
color 0D

cls
echo.
echo  ============================================================
echo     VAPID KEY GENERATOR - Step 3 of 4 (optional)
echo     Enables push notifications for admin order alerts
echo  ============================================================
echo.

if not exist node_modules (
    echo  ERROR - Run 1_INSTALL.bat first!
    pause
    exit /b 1
)

echo  Generating VAPID keys...
echo.

node scripts\generate-vapid.js > "%TEMP%\vapid_output.txt" 2>&1
type "%TEMP%\vapid_output.txt"

set VPUB=
set VPRIV=
for /f "tokens=1,* delims==" %%A in (%TEMP%\vapid_output.txt) do (
    if "%%A"=="VAPID_PUBLIC_KEY"  set VPUB=%%B
    if "%%A"=="VAPID_PRIVATE_KEY" set VPRIV=%%B
)

del "%TEMP%\vapid_output.txt" >nul 2>&1

if not "!VPUB!"=="" (
    if not exist .env ( copy .env.example .env >nul )

    set "_TMP=%TEMP%\pfc_vapid_%RANDOM%.txt"
    findstr /v /b /i "VAPID_PUBLIC_KEY=" .env  > "!_TMP!" 2>nul
    copy /y "!_TMP!" .env >nul 2>&1
    del "!_TMP!" >nul 2>&1

    findstr /v /b /i "VAPID_PRIVATE_KEY=" .env > "!_TMP!" 2>nul
    copy /y "!_TMP!" .env >nul 2>&1
    del "!_TMP!" >nul 2>&1

    echo VAPID_PUBLIC_KEY=!VPUB!>> .env
    echo VAPID_PRIVATE_KEY=!VPRIV!>> .env

    echo.
    echo  OK - VAPID keys automatically saved to .env
    echo.
    echo  IMPORTANT: Also add these to Netlify dashboard
    echo    Site Settings - Environment Variables
    echo    (5_DEPLOY.bat does this automatically)
) else (
    echo.
    echo  WARNING - Could not auto-save. Copy the keys above manually into .env
)

echo.
echo  ============================================================
echo  NEXT: Double-click  4_RUN_LOCAL.bat  to test locally
echo  ============================================================
echo.
pause
