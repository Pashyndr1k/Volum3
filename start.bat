@echo off
setlocal
rem Double-click to run VOLUM3. First run installs what it needs; after that it just starts.
cd /d "%~dp0"
title VOLUM3

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page - install the LTS version, then run this again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. VOLUM3 needs version 20.19 or newer.
  echo Opening the download page - install the LTS version, then run this again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies - first run only, takes a minute...
  call npm install
  if errorlevel 1 (
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo.
echo Starting VOLUM3 - your browser will open in a moment.
echo Keep this window open while you play. Close it to stop.
echo.
call npm run dev -- --open
pause
