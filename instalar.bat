@echo off
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Descargalo de https://nodejs.org ^(version LTS^), instalalo, reinicia la PC y volve a abrir este archivo.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)
echo Instalando Jarvis, puede tardar unos minutos...
call npm install
if errorlevel 1 (
  echo Algo fallo durante la instalacion. Revisa el mensaje de arriba.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Descargando el motor de la ventana ^(Electron^)...
  node node_modules\electron\install.js
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo  No se pudo descargar Electron. Revisa tu conexion o el antivirus y volve a abrir este archivo.
  pause
  exit /b 1
)
echo.
echo  Listo. Ahora abri iniciar.bat
pause
