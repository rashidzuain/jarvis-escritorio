@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  if exist "node_modules\electron\install.js" (
    echo Descargando el motor de la ventana ^(Electron^)...
    node node_modules\electron\install.js
  )
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Primero ejecuta instalar.bat
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
