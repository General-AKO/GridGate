@echo off
set "SCRIPT=%~dp0GridGate_Render_Updater_GUI.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
