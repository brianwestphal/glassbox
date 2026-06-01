@echo off
REM `glassbox-difftool` — git-difftool bridge for Glassbox (Windows desktop install).
REM
REM Copied to PATH by the desktop app's "Install CLI" affordance.
REM Thin wrapper around cli-difftool.js (see src/cli-difftool.ts for the why).

set "SCRIPT_DIR=%~dp0"
"%SCRIPT_DIR%..\bin\glassbox-node.exe" "%SCRIPT_DIR%cli-difftool.js" %*
