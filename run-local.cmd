@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. Node.js 22 LTS kurup tekrar dene.
  echo https://nodejs.org/
  pause
  exit /b 1
)
node scripts\local-runner.mjs
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Bot hata kodu %EXIT_CODE% ile kapandi.
  pause
)
exit /b %EXIT_CODE%
