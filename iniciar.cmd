@echo off
rem Dois cliques: liga A Estacao (se precisar) e abre no navegador.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0iniciar.ps1" %*
