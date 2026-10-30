@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 請先安裝官方Node.js 24.22.1以上的24.x版本，再重新開啟本檔案。
  echo https://nodejs.org/zh-tw/download/archive/v24.22.2
  pause
  exit /b 1
)
node scripts/local.js setup
set "JPLUS_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %JPLUS_EXIT%
