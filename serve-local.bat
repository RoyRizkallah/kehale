@echo off
REM Local dashboard server (no Docker) — use when Docker Desktop is unavailable
cd /d "%~dp0"
echo === Kehale Dashboard (local) ===
echo Building data...
python scripts\build_dashboard_json.py
if errorlevel 1 exit /b 1
echo.
echo Starting on http://localhost:8080
cd dashboard
python -m http.server 8080
