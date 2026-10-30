@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts/local.js start
set "JPLUS_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %JPLUS_EXIT%
