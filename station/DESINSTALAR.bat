@echo off
chcp 65001 >nul
title Desinstalar AVE Checador
net session >nul 2>&1
if errorlevel 1 ( echo Ejecutalo como administrador. & pause & exit /b 1 )
schtasks /End /TN "AVE Checador" >nul 2>&1
if exist "C:\AVE-Checador\datos\pid.txt" for /f %%p in (C:\AVE-Checador\datos\pid.txt) do taskkill /F /PID %%p >nul 2>&1
schtasks /Delete /TN "AVE Checador" /F >nul 2>&1
netsh advfirewall firewall delete rule name="AVE Checador (terminal)" >nul 2>&1
del "%PUBLIC%\Desktop\Checador AVE.url" "%PUBLIC%\Desktop\Checador AVE - Administracion.url" "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\Checador AVE.url" >nul 2>&1
echo.
echo  Desinstalado. Las checadas siguen guardadas en C:\AVE-Checador\datos (no se borraron).
echo  Antes de borrar esa carpeta, confirma en gpoave.com que todo se sincronizo.
pause
