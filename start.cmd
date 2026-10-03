@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem node.exe from the DSH runtime; falls back to node from PATH
set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

rem Extra arguments are passed to server.js, e.g. "start.cmd --mock"
"%NODE%" server.js %*
echo.
echo === Server stopped. ===
pause
