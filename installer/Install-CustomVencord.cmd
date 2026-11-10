@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-CustomVencord.ps1"
set "installerExit=%ERRORLEVEL%"
echo.
if not "%installerExit%"=="0" echo Installer failed. Review the message above before trying again.
pause
exit /b %installerExit%
