@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Portfolio tracker
where py >nul 2>nul && (set PY=py) || (set PY=python)
if not exist ".venv\Scripts\python.exe" (
  echo First-time setup, this can take a few minutes...
  %PY% -m venv .venv || (echo Python not found. Install Python 3.11 or newer from python.org. & pause & exit /b 1)
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
)
rem Install packages when requirements.txt changed (first run or after an update)
fc /b requirements.txt ".venv\installed_requirements.txt" >nul 2>nul
if errorlevel 1 (
  echo Installing packages...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || (echo Package installation failed. Check the error message above. & pause & exit /b 1)
  copy /y requirements.txt ".venv\installed_requirements.txt" >nul
)
echo.
echo Opening the panel: http://localhost:8765
echo Close this window to stop it.
".venv\Scripts\python.exe" server.py
pause
