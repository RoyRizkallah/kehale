@echo off
cd /d "%~dp0"
echo === Kehale Docker Stack ===
echo Dashboard: http://localhost:8080
echo.
docker compose up -d --build
if errorlevel 1 exit /b 1
echo.
docker compose ps
echo.
echo Watch Oracle import:  docker compose logs -f oracle-import
echo Watch analytics:      docker compose logs -f analytics
echo Open dashboard:      http://localhost:8080
