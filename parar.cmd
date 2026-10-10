@echo off
rem Dois cliques: roda o parar.ps1 desta pasta (versao para Windows).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0parar.ps1" %*
pause
