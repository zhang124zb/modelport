@echo off
setlocal
set "APP=%~dp0release\ModelPort.exe"

if not exist "%APP%" (
  echo ModelPort.exe was not found in the release folder.
  echo See README.md for build instructions.
  pause
  exit /b 1
)

start "" "%APP%"
