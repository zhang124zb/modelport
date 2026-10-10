@echo off
setlocal
set "APP=%~dp0release\ModelPort.exe"
if not exist "%APP%" set "APP=%~dp0ModelPort.exe"

if not exist "%APP%" (
  echo ModelPort.exe was not found beside this launcher or in the release folder.
  echo See README.md for build instructions.
  pause
  exit /b 1
)

start "" "%APP%"
