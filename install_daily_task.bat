@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Run start.bat once first.
  pause
  exit /b 1
)
echo This creates a Windows scheduled task that saves the end-of-day snapshot every night at 00:30.
echo Task name: PortfolioEndOfDay   (no admin rights needed, runs only for your user)
echo.
schtasks /Create /F /SC DAILY /ST 00:30 /TN "PortfolioEndOfDay" /TR "\"%~dp0.venv\Scripts\pythonw.exe\" \"%~dp0gun_sonu.py\""
if errorlevel 1 (
  echo Could not create the task. Check the error message above.
  pause
  exit /b 1
)
echo.
echo Done. Running the snapshot once now as a test...
".venv\Scripts\python.exe" gun_sonu.py
echo.
echo To remove the task: schtasks /Delete /TN "PortfolioEndOfDay" /F
pause
