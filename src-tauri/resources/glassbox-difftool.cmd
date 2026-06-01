@echo off
REM `glassbox-difftool` — git-difftool bridge for Glassbox (Windows desktop install).
REM
REM Copied to PATH by the desktop app's "Install CLI" affordance.
REM Thin wrapper around cli-difftool.js (see src/cli-difftool.ts for the why).
REM Paths verified against the Windows build layout (GB-856): this shim lives at
REM <install>\resources\glassbox-difftool.cmd; the Node binary is one level up
REM (<install>\glassbox-node.exe) and cli-difftool.js is in <install>\server\.

set "SCRIPT_DIR=%~dp0"
"%SCRIPT_DIR%..\glassbox-node.exe" "%SCRIPT_DIR%..\server\cli-difftool.js" %*
