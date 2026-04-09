@echo off
setlocal enabledelayedexpansion
title Padmavathi Fruits - Status Check
color 0B

cls
echo.
echo  ============================================================
echo     STATUS CHECK - Everything You Need to Deploy
echo  ============================================================
echo.

set ISSUES=0

node --version >nul 2>&1
if errorlevel 1 (
    echo  FAIL - Node.js        NOT INSTALLED
    echo         https://nodejs.org  download LTS
    set /a ISSUES+=1
) else (
    for /f "tokens=*" %%v in ('node --version') do echo  OK   - Node.js        %%v
)

npm --version >nul 2>&1
if errorlevel 1 (
    echo  FAIL - npm            NOT FOUND - reinstall Node.js
    set /a ISSUES+=1
) else (
    for /f "tokens=*" %%v in ('npm --version') do echo  OK   - npm            %%v
)

if exist node_modules (
    echo  OK   - node_modules   installed
) else (
    echo  FAIL - node_modules   MISSING - run 1_INSTALL.bat
    set /a ISSUES+=1
)

if exist netlify.toml (
    echo  OK   - netlify.toml   present
) else (
    echo  FAIL - netlify.toml   MISSING
    set /a ISSUES+=1
)

if exist netlify\functions\api.js (
    echo  OK   - api.js         present
) else (
    echo  FAIL - api.js         MISSING
    set /a ISSUES+=1
)

if exist public\index.html (
    echo  OK   - index.html     present
) else (
    echo  FAIL - index.html     MISSING
    set /a ISSUES+=1
)

echo.
if not exist .env (
    echo  FAIL - .env           MISSING - run 2_CONFIGURE.bat
    set /a ISSUES+=1
    goto DONE
)
echo  OK   - .env           present

call :CHECKENV MONGODB_URI          "mongodb+srv"  "Run 2_CONFIGURE.bat to set MongoDB URI"
call :CHECKENV CLOUDINARY_CLOUD_NAME "your_cloud"  "Run 2_CONFIGURE.bat to set Cloudinary"
call :CHECKENV CLOUDINARY_API_KEY   "your_api"     "Run 2_CONFIGURE.bat to set Cloudinary"
call :CHECKENV CLOUDINARY_API_SECRET "your_api"    "Run 2_CONFIGURE.bat to set Cloudinary"
call :CHECKENV JWT_SECRET           "replace_with" "Run 2_CONFIGURE.bat - auto-generates"
call :CHECKENV JWT_REFRESH_SECRET   "replace_with" "Run 2_CONFIGURE.bat - auto-generates"
call :CHECKENV VAPID_PUBLIC_KEY     "your_vapid"   "Run 3_VAPID.bat to generate"
call :CHECKENV VAPID_PRIVATE_KEY    "your_vapid"   "Run 3_VAPID.bat to generate"

echo.
npx netlify status >nul 2>&1
if errorlevel 1 (
    echo  WARN - Netlify        not logged in - run 5_DEPLOY.bat to login
) else (
    echo  OK   - Netlify        logged in
)

if exist .netlify\state.json (
    echo  OK   - Netlify site   linked
) else (
    echo  WARN - Netlify site   not linked yet - 5_DEPLOY.bat will link it
)

:DONE
echo.
echo  ============================================================
if !ISSUES! EQU 0 (
    echo  All checks passed! You are ready to deploy.
    echo  Run  5_DEPLOY.bat  to go live.
) else (
    echo  !ISSUES! issue(s) found. Fix them before deploying.
)
echo  ============================================================
echo.
pause
exit /b 0

:CHECKENV
set "_VAR=%~1"
set "_BAD=%~2"
set "_FIX=%~3"
set "_VAL="
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="%_VAR%" set "_VAL=%%B"
)
if "!_VAL!"=="" (
    echo  FAIL - %_VAR% NOT SET - %_FIX%
    set /a ISSUES+=1
) else (
    echo !_VAL! | findstr /i "%_BAD%" >nul 2>&1
    if not errorlevel 1 (
        echo  WARN - %_VAR% still has placeholder value - %_FIX%
        set /a ISSUES+=1
    ) else (
        echo  OK   - %_VAR% configured
    )
)
goto :EOF
