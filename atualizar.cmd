@echo off
rem Dois cliques: roda o atualizar.ps1 desta pasta (versao para Windows).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar.ps1" %*
pause
