@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem node.exe from the DSH runtime; falls back to node from PATH
set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

rem Optional argument limits connection method: tcp443 | tcp80 | wss
if not "%~1"=="" set "TG_ONLY=%~1"

if /i "%NODE%"=="node" goto checkpath
if exist "%NODE%" goto nodeok
echo [x] node.exe not found: %NODE%
echo     Install Node.js or fix the NODE path inside this file.
pause
exit /b 1

:checkpath
where node >nul 2>&1
if errorlevel 1 (
  echo [x] node.exe not found in PATH
  pause
  exit /b 1
)

:nodeok
if not exist "node_modules\telegram" (
  echo [x] Dependencies are missing in this folder.
  echo     Run "pnpm install" here.
  pause
  exit /b 1
)

echo === MTProto username check ===
echo node: %NODE%
if defined TG_ONLY echo connection: only %TG_ONLY%
echo.
"%NODE%" probe.mjs
echo.
echo === Done (exit code %ERRORLEVEL%). Copy everything above and send it back. ===
pause
