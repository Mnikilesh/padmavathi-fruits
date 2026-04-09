@echo off
setlocal enabledelayedexpansion
title Padmavathi Fruits - Deploy to Netlify
color 0E

cls
echo.
echo  ============================================================
echo     DEPLOY TO NETLIFY - Go Live on the Internet (FREE)
echo  ============================================================
echo.
echo  This will:
echo    1. Log you into Netlify (opens browser once)
echo    2. Create/link your site automatically
echo    3. Upload all secrets from .env to Netlify
echo    4. Deploy your project live
echo.
echo  Make sure you completed steps 1-3 first:
echo    1_INSTALL.bat - 2_CONFIGURE.bat - 3_VAPID.bat
echo.
set /p READY="  Ready to deploy? (y/N): "
if /i not "!READY!"=="y" (
    echo  Cancelled.
    pause
    exit /b 0
)

if not exist node_modules (
    echo  Installing dependencies first...
    call npm install
    if errorlevel 1 (
        echo  ERROR - npm install failed
        pause
        exit /b 1
    )
)

if not exist .env (
    echo  ERROR - .env not found. Run 2_CONFIGURE.bat first.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo  Step 1 of 4 - Logging into Netlify...
echo  Your browser will open - log in with GitHub or email
echo  ============================================================
echo.
npx netlify login
if errorlevel 1 (
    echo  ERROR - Login failed. Check your internet and try again.
    pause
    exit /b 1
)
echo  OK - Logged in

echo.
echo  ============================================================
echo  Step 2 of 4 - Linking Netlify site...
echo  ============================================================
echo.
if exist .netlify\state.json (
    echo  OK - Already linked to a Netlify site.
) else (
    echo  You will be asked to create a new site or link existing
    echo.
    npx netlify init
    if errorlevel 1 (
        echo  ERROR - Site init failed.
        pause
        exit /b 1
    )
)

echo.
echo  ============================================================
echo  Step 3 of 4 - Uploading environment variables to Netlify...
echo  ============================================================
echo.

set PUSHED=0
set SKIPPED=0
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    set "_K=%%A"
    set "_V=%%B"
    if not "!_K!"=="" (
        if not "!_V!"=="" (
            for /f "tokens=*" %%x in ("!_K!") do set "_K=%%x"
            npx netlify env:set "!_K!" "!_V!" >nul 2>&1
            if errorlevel 1 (
                echo  WARNING - Could not push: !_K!
                set /a SKIPPED+=1
            ) else (
                echo  OK - !_K!
                set /a PUSHED+=1
            )
        )
    )
)
echo.
echo  Pushed !PUSHED! variables, skipped !SKIPPED!.

echo.
echo  ============================================================
echo  Step 4 of 4 - Deploying to production...
echo  ============================================================
echo.
npx netlify deploy --prod
if errorlevel 1 (
    echo.
    echo  ERROR - Deploy failed! Common causes:
    echo    - Not linked to a site (try: npx netlify init)
    echo    - netlify.toml error
    echo    - Network issue
    echo.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo  YOUR SITE IS LIVE ON THE INTERNET!
echo.
echo  To open your live site:   npx netlify open:site
echo  To view your dashboard:   npx netlify open
echo  To deploy again:          Run 5_DEPLOY.bat again
echo  ============================================================
echo.
set /p OPEN="  Open your live site in browser now? (Y/n): "
if /i not "!OPEN!"=="n" (
    npx netlify open:site
)
pause
