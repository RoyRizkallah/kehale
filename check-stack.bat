@echo off
cd /d "%~dp0"
echo === Kehale Stack Health Check ===
echo.

set OK=1

if exist "MONDAY_165.DMP" (echo [OK] MONDAY_165.DMP) else (echo [MISSING] MONDAY_165.DMP & set OK=0)
if exist "municipal_analysis\RECEIPTS.csv" (echo [OK] municipal_analysis\RECEIPTS.csv) else (echo [MISSING] RECEIPTS.csv & set OK=0)
if exist "dashboard\index.html" (echo [OK] dashboard\index.html) else (echo [MISSING] dashboard & set OK=0)
if exist "dashboard\styles.css" (echo [OK] dashboard\styles.css) else (echo [MISSING] styles.css & set OK=0)
if exist "dashboard\app.js" (echo [OK] dashboard\app.js) else (echo [MISSING] app.js & set OK=0)
if exist "dashboard\data\kehale.json" (echo [OK] dashboard\data\kehale.json) else (echo [WARN] kehale.json - run: python scripts\build_dashboard_json.py)
if exist "dashboard\data\payments.json" (echo [OK] dashboard\data\payments.json) else (echo [WARN] payments.json - run: python scripts\build_dashboard_json.py)
if exist "docker-compose.yml" (echo [OK] docker-compose.yml) else (echo [MISSING] docker-compose.yml & set OK=0)
if exist "docker-compose.lite.yml" (echo [OK] docker-compose.lite.yml) else (echo [MISSING] docker-compose.lite.yml)

echo.
echo --- Docker ---
docker info >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Docker engine not running
  echo        Start Docker Desktop, then run: docker-start.bat
  set OK=0
) else (
  echo [OK] Docker client responds
  docker compose ps 2>nul
)

echo.
if %OK%==1 (
  echo All core files present.
) else (
  echo Some checks failed — see above.
)
echo.
echo Full stack:  docker-start.bat
echo Lite stack:  docker compose -f docker-compose.lite.yml up -d --build
echo Local only:  serve-local.bat  ^(http://localhost:8080^)
