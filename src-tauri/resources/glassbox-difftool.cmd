@echo off
REM `glassbox-difftool` - git-difftool bridge for Glassbox (Windows desktop install).
REM
REM Copied to PATH by the desktop app's "Install CLI" affordance.
REM Thin wrapper around cli-difftool.js (see src/cli-difftool.ts for the why).
REM
REM Locating the app: same scheme as glassbox.cmd. Inside the bundle this shim
REM lives at <install>\resources\glassbox-difftool.cmd, the Node binary is one
REM level up (<install>\glassbox-node.exe) and cli-difftool.js is in
REM <install>\server\ (GB-856). The installed copy in Programs\glassbox\ can't
REM use that relative default (GitHub #59), so the installer swaps the marker
REM line for an absolute `set`, with the standard install dirs as a fallback.

set "GLASSBOX_APP_DIR=%~dp0.."
REM @@GLASSBOX_APP_DIR@@
if not exist "%GLASSBOX_APP_DIR%\glassbox.exe" if exist "%LOCALAPPDATA%\Glassbox\glassbox.exe" set "GLASSBOX_APP_DIR=%LOCALAPPDATA%\Glassbox"
if not exist "%GLASSBOX_APP_DIR%\glassbox.exe" if exist "%ProgramFiles%\Glassbox\glassbox.exe" set "GLASSBOX_APP_DIR=%ProgramFiles%\Glassbox"
if not exist "%GLASSBOX_APP_DIR%\glassbox.exe" (
    echo Glassbox: the desktop app was not found ^(looked in "%GLASSBOX_APP_DIR%"^). 1>&2
    echo Reinstall the CLI from the Glassbox app's welcome screen. 1>&2
    exit /b 1
)

"%GLASSBOX_APP_DIR%\glassbox-node.exe" "%GLASSBOX_APP_DIR%\server\cli-difftool.js" %*
