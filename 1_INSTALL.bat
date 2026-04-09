@echo off
setlocal enabledelayedexpansion
title Padmavathi Fruits - Install
color 0A

cls
echo.
echo  ============================================================
echo     INSTALL - Step 1 of 4
echo     Installs all dependencies automatically
echo  ============================================================
echo.

echo  Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ============================================================
    echo     ERROR: Node.js is NOT installed on this computer.
    echo.
    echo     Please install it now:
    echo     https://nodejs.org  - click the LTS button
    echo.
    echo     After installing, double-click 1_INSTALL.bat again.
    echo  ============================================================
    echo.
    echo  Opening nodejs.org in your browser...
    start https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do (
    echo  OK - Node.js %%v is installed
)

echo.
echo  Installing packages (mongoose, cloudinary, bcryptjs, etc.)
echo  This takes about 1-2 minutes on first run...
echo.
call npm install
if errorlevel 1 (
    echo.
    echo  ERROR - Installation failed!
    echo  Possible causes:
    echo    - No internet connection
    echo    - npm registry is temporarily down
    echo  Try again in a minute.
    echo.
    pause
    exit /b 1
)

if not exist .env (
    copy .env.example .env >nul
    echo  OK - Created .env config file
) else (
    echo  OK - .env already exists (kept as-is)
)

echo.
echo  ============================================================
echo  OK - Installation complete!
echo.
echo  NEXT: Double-click  2_CONFIGURE.bat
echo        to enter your MongoDB, Cloudinary and other keys.
echo  ============================================================
echo.
pause
