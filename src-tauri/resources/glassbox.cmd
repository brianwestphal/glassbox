@echo off
REM CLI launcher for Glassbox desktop app (Windows).
REM The desktop app's "Install CLI" copies this file to
REM %LOCALAPPDATA%\Programs\glassbox\ and adds that folder to PATH.
REM
REM Locating the app. Inside the bundle this shim lives at
REM <install>\resources\glassbox.cmd with the binaries one level up
REM (<install>\glassbox.exe, <install>\glassbox-node.exe) and the Node server in
REM <install>\server\ (verified against the Windows build layout, GB-856). So the
REM default is relative to this file. That default is WRONG for the installed
REM copy in Programs\glassbox\ (it once failed with "...\Programs\glassbox\..\
REM glassbox.exe cannot be found", GitHub #59), so the installer swaps the
REM marker line below for an absolute `set`, and as a last resort (a manual
REM copy) the shim checks the standard per-user and per-machine install dirs.

set "GLASSBOX_APP_DIR=%~dp0.."
REM @@GLASSBOX_APP_DIR@@
if not exist "%GLASSBOX_APP_DIR%\glassbox.exe" if exist "%LOCALAPPDATA%\Glassbox\glassbox.exe" set "GLASSBOX_APP_DIR=%LOCALAPPDATA%\Glassbox"
if not exist "%GLASSBOX_APP_DIR%\glassbox.exe" if exist "%ProgramFiles%\Glassbox\glassbox.exe" set "GLASSBOX_APP_DIR=%ProgramFiles%\Glassbox"
if not exist "%GLASSBOX_APP_DIR%\glassbox.exe" (
    echo Glassbox: the desktop app was not found ^(looked in "%GLASSBOX_APP_DIR%"^). 1>&2
    echo Reinstall the CLI from the Glassbox app's welcome screen. 1>&2
    exit /b 1
)

set "PROJECT_DIR=%CD%"
set "BROWSER_MODE=0"

REM Standalone CLI subcommands (doc 20 / doc 19 -- "note ...", "ground-truth
REM promote ...") run cli.js directly and exit: no app launch. Without this the
REM wrapper prepends --project-dir, so cli.js never sees the subcommand as
REM argv[0] and dies with "Unknown option" (Hot Sheet HS-9371).
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

REM %* is the untouched original argument list (shift does not affect it), so
REM both branches forward every user flag (--commit, --staged, ...). In browser
REM mode that includes --browser itself, which cli.js accepts as a no-op - cmd
REM can't filter one token out of %* without re-quoting every argument.
if "%BROWSER_MODE%"=="1" (
    REM Run the Node server directly; it opens the review in the default browser.
    "%GLASSBOX_APP_DIR%\glassbox-node.exe" "%GLASSBOX_APP_DIR%\server\cli.js" --project-dir "%PROJECT_DIR%" %*
) else (
    if defined GLASSBOX_DIFFTOOL_BLOCK (
        REM Invoked by glassbox-difftool: run the app in the foreground so the
        REM caller blocks until the window closes (keeps the difftool temp
        REM snapshot alive and sequences per-file mode). No `start`.
        "%GLASSBOX_APP_DIR%\glassbox.exe" --project-dir "%PROJECT_DIR%" %*
    ) else (
        start "" "%GLASSBOX_APP_DIR%\glassbox.exe" --project-dir "%PROJECT_DIR%" %*
    )
)
goto :eof

:run_cli_direct
"%GLASSBOX_APP_DIR%\glassbox-node.exe" "%GLASSBOX_APP_DIR%\server\cli.js" %*
exit /b %ERRORLEVEL%
