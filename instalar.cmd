@echo off
rem Dois cliques: roda o instalar.ps1 desta pasta (versao para Windows).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
pause
