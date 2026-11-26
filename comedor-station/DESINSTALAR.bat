@echo off
chcp 65001 >nul
title Desinstalar AVE Meal Counter
net session >nul 2>&1
if errorlevel 1 ( echo Ejecutalo como administrador. & pause & exit /b 1 )
schtasks /End /TN "AVE Comedor" >nul 2>&1
if exist "C:\AVE-Comedor\datos\pid.txt" for /f %%p in (C:\AVE-Comedor\datos\pid.txt) do taskkill /F /PID %%p >nul 2>&1
schtasks /Delete /TN "AVE Comedor" /F >nul 2>&1
del "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\Meal Counter AVE.bat" "%PUBLIC%\Desktop\Meal Counter AVE.bat" "%PUBLIC%\Desktop\Meal Counter AVE - Administracion.url" >nul 2>&1
echo.
echo  Desinstalado. Las comidas siguen guardadas en C:\AVE-Comedor\datos (no se borraron).
echo  Antes de borrar esa carpeta, confirma en gpoave.com que todo se sincronizo.
pause
