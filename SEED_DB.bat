@echo off
setlocal enabledelayedexpansion
title Padmavathi Fruits - Seed Database
color 0A

cls
echo.
echo  ============================================================
echo     SEED DATABASE
echo     Loads default fruits + creates admin account
echo  ============================================================
echo.

if not exist node_modules (
    echo  ERROR - Run 1_INSTALL.bat first!
    pause
    exit /b 1
)

if not exist .env (
    echo  ERROR - Run 2_CONFIGURE.bat first!
    pause
    exit /b 1
)

findstr /i "mongodb+srv" .env >nul 2>&1
if errorlevel 1 (
    echo  ERROR - MONGODB_URI is not configured in .env
    echo  Run 2_CONFIGURE.bat to set it.
    pause
    exit /b 1
)

echo  Connecting to MongoDB Atlas and seeding...
echo.
node scripts\seed.js
echo.

if errorlevel 1 (
    echo  ERROR - Seeding failed. Check your MONGODB_URI in .env.
) else (
    echo  OK - Database seeded successfully!
)

echo.
pause
