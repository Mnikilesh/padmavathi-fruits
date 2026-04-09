@echo off
setlocal enabledelayedexpansion
title Padmavathi Fruits - Configure Secrets
color 0B

cls
echo.
echo  ============================================================
echo     CONFIGURE - Step 2 of 4
echo     Set up your MongoDB, Cloudinary, and JWT secrets
echo  ============================================================
echo.
echo  Your answers are saved ONLY to your local .env file.
echo  Nothing is sent to the internet here.
echo.

if not exist node_modules (
    echo  ERROR - Please run 1_INSTALL.bat first!
    pause
    exit /b 1
)

if not exist .env (
    copy .env.example .env >nul
    echo  Created fresh .env from template.
    echo.
)

echo  ============================================================
echo   1. MONGODB ATLAS
echo  ============================================================
echo.
echo  How to get your MongoDB URI:
echo    a) Go to https://cloud.mongodb.com
echo    b) Create free M0 cluster (Mumbai region)
echo    c) Database Access - Add user + password
echo    d) Network Access  - Add 0.0.0.0/0
echo    e) Connect - Drivers - Node.js - Copy the URI
echo.
echo  It looks like:
echo    mongodb+srv://user:pass@cluster0.abc.mongodb.net/padmavathi_fruits
echo.
set /p MONGO="  Paste your MongoDB Atlas URI (Enter to skip): "
if not "!MONGO!"=="" (
    call :SETENV MONGODB_URI "!MONGO!"
    echo  OK - MONGODB_URI saved
) else (
    echo  SKIPPED - edit .env manually later
)

echo.
echo  ============================================================
echo   2. CLOUDINARY (image hosting)
echo  ============================================================
echo.
echo  How to get Cloudinary credentials:
echo    a) Go to https://cloudinary.com - Free account
echo    b) Dashboard shows Cloud Name, API Key, API Secret
echo.
set /p CLD_NAME="  Cloud Name   (Enter to skip): "
if not "!CLD_NAME!"=="" (
    call :SETENV CLOUDINARY_CLOUD_NAME "!CLD_NAME!"
    echo  OK - CLOUDINARY_CLOUD_NAME saved
)
set /p CLD_KEY="  API Key      (Enter to skip): "
if not "!CLD_KEY!"=="" (
    call :SETENV CLOUDINARY_API_KEY "!CLD_KEY!"
    echo  OK - CLOUDINARY_API_KEY saved
)
set /p CLD_SEC="  API Secret   (Enter to skip): "
if not "!CLD_SEC!"=="" (
    call :SETENV CLOUDINARY_API_SECRET "!CLD_SEC!"
    echo  OK - CLOUDINARY_API_SECRET saved
)

echo.
echo  ============================================================
echo   3. JWT SECRETS
echo  ============================================================
echo.
echo  These are used to sign login tokens. Auto-generate is safe.
echo.
set /p DO_JWT="  Auto-generate secure JWT secrets? (Y/n): "
if /i "!DO_JWT!"=="n" (
    set /p J1="  JWT_SECRET (min 32 chars): "
    set /p J2="  JWT_REFRESH_SECRET (min 32 chars): "
    if not "!J1!"=="" call :SETENV JWT_SECRET "!J1!"
    if not "!J2!"=="" call :SETENV JWT_REFRESH_SECRET "!J2!"
) else (
    for /f "tokens=*" %%r in ('node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"') do set J1=%%r
    for /f "tokens=*" %%r in ('node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"') do set J2=%%r
    call :SETENV JWT_SECRET "!J1!"
    call :SETENV JWT_REFRESH_SECRET "!J2!"
    echo  OK - JWT secrets auto-generated and saved
)

echo.
echo  ============================================================
echo   4. ADMIN ACCOUNT
echo  ============================================================
echo.
echo  This admin account is created automatically when the DB
echo  is first populated.
echo.
set /p AEMAIL="  Admin email   [admin@padmavathifruits.com]: "
if "!AEMAIL!"=="" set AEMAIL=admin@padmavathifruits.com
call :SETENV ADMIN_EMAIL "!AEMAIL!"

set /p APASS="  Admin password [Admin@1234]: "
if "!APASS!"=="" set APASS=Admin@1234
call :SETENV ADMIN_PASSWORD "!APASS!"
echo  OK - Admin credentials saved

echo.
echo  ============================================================
echo   5. VAPID KEYS (push notifications - optional)
echo  ============================================================
echo.
echo  If you have not generated VAPID keys yet, run 3_VAPID.bat first.
echo  You can also skip this and add keys later.
echo.
set /p VPUB="  VAPID Public Key  (Enter to skip): "
if not "!VPUB!"=="" (
    call :SETENV VAPID_PUBLIC_KEY "!VPUB!"
    echo  OK - VAPID_PUBLIC_KEY saved
)
set /p VPRIV="  VAPID Private Key (Enter to skip): "
if not "!VPRIV!"=="" (
    call :SETENV VAPID_PRIVATE_KEY "!VPRIV!"
    echo  OK - VAPID_PRIVATE_KEY saved
)

echo.
echo  ============================================================
echo  OK - Configuration complete - .env has been updated.
echo.
echo  NEXT STEPS:
echo    Run  3_VAPID.bat      to generate push notification keys
echo    Run  4_RUN_LOCAL.bat  to test everything locally
echo    Run  5_DEPLOY.bat     to go live on Netlify
echo  ============================================================
echo.
pause
exit /b 0

:SETENV
set "_K=%~1"
set "_V=%~2"
set "_TMP=%TEMP%\pfc_tmp_%RANDOM%.txt"
if exist .env (
    findstr /v /b /i "%_K%=" .env > "!_TMP!" 2>nul
    copy /y "!_TMP!" .env >nul 2>&1
    del "!_TMP!" >nul 2>&1
)
echo %_K%=%_V%>> .env
goto :EOF
