@echo off
rem Abre la pantalla del comedor en Edge, pantalla completa. Para salir: Alt+F4.
timeout /t 8 /nobreak >nul
start "" msedge --kiosk "http://localhost:8790/" --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required --no-first-run
