@echo off
rem Lo ejecuta Windows al encender la PC (tarea "AVE Comedor"). Si el programa se cierra, se vuelve a abrir.
cd /d "%~dp0"
set "NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist datos mkdir datos
:loop
"%NODE%" server.js >> datos\consola.txt 2>&1
timeout /t 10 /nobreak >nul
goto loop
