@echo off
setlocal enabledelayedexpansion
title Padmavathi Fruits - Local Dev Server
color 0A

cls
echo.
echo  ============================================================
echo     RUN LOCALLY - Step 4 of 4
echo     Starts Netlify Dev at http://localhost:8888
echo  ============================================================
echo.

set ERRORS=0

node --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR - Node.js not installed. Run 1_INSTALL.bat first.
    set /a ERRORS+=1
)

if not exist node_modules (
    echo  ERROR - node_modules missing. Run 1_INSTALL.bat first.
    set /a ERRORS+=1
)

if not exist .env (
    echo  ERROR - .env missing. Run 2_CONFIGURE.bat first.
    set /a ERRORS+=1
)

if !ERRORS! GTR 0 (
    echo.
    pause
    exit /b 1
)

findstr /i "mongodb+srv" .env >nul 2>&1
if errorlevel 1 (
    echo  WARNING - MONGODB_URI does not look set in .env
    echo  API calls will fail. Run 2_CONFIGURE.bat first.
    echo.
    set /p CONT="  Start anyway? (y/N): "
    if /i not "!CONT!"=="y" exit /b 1
    echo.
)

echo  Pre-flight checks passed - OK
echo.
echo  ============================================================
echo   Frontend : http://localhost:8080
echo   API      : http://localhost:8080/api/
echo   Admin    : Use email+password from 2_CONFIGURE.bat
echo  ============================================================
echo.
echo  Opening browser in 3 seconds...
echo  Press Ctrl+C in this window to stop the server.
echo.

ping -n 4 127.0.0.1 >nul 2>&1
start "" "http://localhost:8080"

npx netlify dev

echo.
echo  Server stopped.
pause
