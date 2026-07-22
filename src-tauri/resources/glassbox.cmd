@echo off
REM CLI launcher for Glassbox desktop app (Windows).
REM Add the directory containing this file to your PATH.
REM
REM Paths verified against the Windows build layout (GB-856): the shim lives at
REM <install>\resources\glassbox.cmd, with the binaries one level up
REM (<install>\glassbox.exe, <install>\glassbox-node.exe) and the Node server in
REM <install>\server\. So from %~dp0 (= <install>\resources\): node + exe are
REM "..\", and cli.js is "..\server\".

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%CD%"
set "BROWSER_MODE=0"

REM Standalone CLI subcommands (doc 20 / doc 19 -- "note ...", "ground-truth
REM promote ...") run cli.js directly and exit: no app launch. Without this the
REM wrapper prepends --no-open/--project-dir, so cli.js never sees the
REM subcommand as argv[0] and dies with "Unknown option" (Hot Sheet HS-9371).
if "%~1"=="note" goto run_cli_direct
if "%~1"=="ground-truth" goto run_cli_direct

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
    "%SCRIPT_DIR%..\glassbox-node.exe" "%SCRIPT_DIR%..\server\cli.js" --no-open --project-dir "%PROJECT_DIR%" %*
) else (
    if defined GLASSBOX_DIFFTOOL_BLOCK (
        REM Invoked by glassbox-difftool: run the app in the foreground so the
        REM caller blocks until the window closes (keeps the difftool temp
        REM snapshot alive and sequences per-file mode). No `start`.
        "%SCRIPT_DIR%..\glassbox.exe" --project-dir "%PROJECT_DIR%" %*
    ) else (
        start "" "%SCRIPT_DIR%..\glassbox.exe" --project-dir "%PROJECT_DIR%" %*
    )
)
goto :eof

:run_cli_direct
"%SCRIPT_DIR%..\glassbox-node.exe" "%SCRIPT_DIR%..\server\cli.js" %*
exit /b %ERRORLEVEL%
