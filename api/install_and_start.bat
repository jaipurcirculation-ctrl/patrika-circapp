@echo off
title Patrika Vitran — API Server
color 1F
echo.
echo  =========================================
echo   Patrika Vitran Suite — API Server
echo  =========================================
echo.
echo  Step 1: Installing Python packages...
echo  (only needed the first time, takes ~1 minute)
echo.
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: pip install failed.
    echo  Make sure Python is installed and 'pip' is available.
    pause
    exit /b 1
)
echo.
echo  Step 2: Starting API server on port 8000...
echo  API docs will be at: http://localhost:8000/docs
echo.
echo  IMPORTANT: Edit config.py and set your PostgreSQL password
echo  before starting, if you have not done so already.
echo.
echo  Press Ctrl+C to stop the server.
echo.
python server.py
pause
