@echo off
REM CLI launcher for Glassbox desktop app (Windows).
REM Add the directory containing this file to your PATH.

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%CD%"
set "BROWSER_MODE=0"

:parse_args
if "%~1"=="" goto done_args
if "%~1"=="--browser" (
    set "BROWSER_MODE=1"
    shift
    goto parse_args
)
shift
goto parse_args

:done_args

if "%BROWSER_MODE%"=="1" (
    "%SCRIPT_DIR%..\bin\glassbox-node.exe" "%SCRIPT_DIR%cli.js" --no-open --project-dir "%PROJECT_DIR%" %*
) else (
    start "" "%SCRIPT_DIR%..\bin\glassbox.exe" --project-dir "%PROJECT_DIR%" %*
)
