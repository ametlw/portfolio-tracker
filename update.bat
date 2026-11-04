@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Portfolio tracker - package update
if not exist ".venv\Scripts\python.exe" (
  echo Run start.bat once first.
  pause
  exit /b 1
)
echo Updating the price library (yfinance).
echo Run this if prices stop loading or every holding shows "no price".
echo Close the panel first if it is open.
echo.
".venv\Scripts\python.exe" -m pip install --upgrade yfinance
if errorlevel 1 (
  echo Update failed. Check the error message above.
  pause
  exit /b 1
)
echo.
".venv\Scripts\python.exe" -c "import yfinance; print('yfinance version: ' + yfinance.__version__)"
echo.
echo Done. Start the panel again.
pause
