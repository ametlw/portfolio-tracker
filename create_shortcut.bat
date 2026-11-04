@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Run start.bat once first so the setup can finish.
  pause
  exit /b 1
)
echo Creating a "Portfolio" shortcut on your desktop...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=[Environment]::GetFolderPath('Desktop'); $k=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Portfolio.lnk')); $k.TargetPath='%~dp0.venv\Scripts\pythonw.exe'; $k.Arguments='\"%~dp0uygulama.pyw\"'; $k.WorkingDirectory='%~dp0'; $k.IconLocation='%~dp0static\portfoy.ico'; $k.Description='Portfolio tracker'; $k.Save()"
if errorlevel 1 (
  echo Could not create the shortcut. Check the error message above.
  pause
  exit /b 1
)
echo.
echo Done. Double-click "Portfolio" on your desktop.
echo The panel opens in its own window; closing the window also stops the background server.
echo To pin it to the taskbar, right-click the DESKTOP shortcut ("Show more options") - "Pin to taskbar".
echo Do not pin the open window's taskbar icon, that one does not start the server.
pause
