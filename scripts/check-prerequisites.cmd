@echo off
REM Double-click this file on Windows to run the prerequisite check.
REM The window stays open until you press Enter.
setlocal
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-prerequisites.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
