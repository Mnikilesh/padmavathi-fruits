@echo off
setlocal
title Padmavathi Fruits - Open .env

if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo  Created .env from template.
    ) else (
        echo  ERROR - .env and .env.example both missing!
        pause
        exit /b 1
    )
)

echo  Opening .env in Notepad...
echo  Save the file after editing, then restart the server.
notepad .env
