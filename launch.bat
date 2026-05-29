@echo off
echo Starting ThumbGen...
cd /d "%~dp0.."
start "ThumbGen" cmd /c "npx electron electron/main.js"
