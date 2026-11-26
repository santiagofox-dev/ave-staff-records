@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Instalar AVE Meal Counter
rem Instala (o actualiza) el Meal Counter en C:\AVE-Comedor. Las comidas guardadas (carpeta datos) no se tocan.

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Haz clic derecho en INSTALAR.bat y elige "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

set "DEST=C:\AVE-Comedor"
set "NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo Instalando Node.js LTS con winget ^(necesita internet solo esta vez^)...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  set "NODE=%ProgramFiles%\nodejs\node.exe"
)
"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo.
  echo  No se pudo instalar Node.js automaticamente.
  echo  Descargalo de https://nodejs.org ^(boton LTS^), instalalo y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

echo Deteniendo la version anterior ^(si existe^)...
schtasks /End /TN "AVE Comedor" >nul 2>&1
if exist "%DEST%\datos\pid.txt" for /f %%p in (%DEST%\datos\pid.txt) do taskkill /F /PID %%p >nul 2>&1

echo Copiando el programa a %DEST% ...
robocopy "%~dp0." "%DEST%" /E /XD datos /XF INSTALAR.bat /NFL /NDL /NJH /NJS /NP >nul
if not exist "%DEST%\datos" mkdir "%DEST%\datos"

echo Configurando el arranque automatico ^(aunque nadie inicie sesion^)...
schtasks /Create /TN "AVE Comedor" /TR "\"%DEST%\iniciar.bat\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul

echo Evitando que la PC se suspenda o apague la pantalla...
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 0 >nul 2>&1
w32tm /resync >nul 2>&1

echo Creando accesos directos...
copy /Y "%DEST%\pantalla.bat" "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\Meal Counter AVE.bat" >nul
copy /Y "%DEST%\pantalla.bat" "%PUBLIC%\Desktop\Meal Counter AVE.bat" >nul
(echo [InternetShortcut]& echo URL=http://localhost:8790/admin) > "%PUBLIC%\Desktop\Meal Counter AVE - Administracion.url"

schtasks /Run /TN "AVE Comedor" >nul
timeout /t 4 /nobreak >nul
start "" "http://localhost:8790/admin"
echo.
echo  Listo. El Meal Counter ya esta corriendo y arranca solo cada vez que se prende la PC.
echo  Al iniciar sesion en Windows se abre la pantalla del comedor en pantalla completa.
echo  Administracion: http://localhost:8790/admin
echo.
pause
