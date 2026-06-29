#!/bin/bash
set -euo pipefail

echo "=== Kehale Analytics Pipeline ==="

MARKER="${ORACLE_IMPORT_MARKER:-/data/.oracle_import_done}"
WAIT_IMPORT="${WAIT_FOR_IMPORT:-true}"
USE_CSV="${USE_CSV_FALLBACK:-false}"
IMPORT_OK=false

if [ "$USE_CSV" = "true" ]; then
  echo "CSV fallback mode — skipping Oracle wait."
elif [ "$WAIT_IMPORT" = "true" ]; then
  echo "Waiting for Oracle import marker: $MARKER"
  elapsed=0
  max_wait="${IMPORT_MAX_WAIT:-7200}"
  while [ ! -f "$MARKER" ] && [ "$elapsed" -lt "$max_wait" ]; do
    sleep 15
    elapsed=$((elapsed + 15))
    if [ $((elapsed % 60)) -eq 0 ]; then
      echo "  ...import in progress (${elapsed}s / ${max_wait}s)"
    fi
  done
  if [ -f "$MARKER" ]; then
    IMPORT_OK=true
    echo "Oracle import marker found."
  else
    echo "WARN: Oracle import not finished in ${max_wait}s — falling back to municipal_analysis CSVs."
    USE_CSV=true
  fi
else
  IMPORT_OK=true
fi

if [ "$USE_CSV" != "true" ]; then
  /app/docker/wait-for-oracle.sh
  echo ">>> ETL: Oracle → SQLite"
  if python - <<'PY'
from kehale_analytics.etl import export_oracle_to_sqlite
counts = export_oracle_to_sqlite()
ok = sum(1 for v in counts.values() if v > 0)
print(f"Exported {ok}/{len(counts)} tables")
raise SystemExit(0 if ok > 0 else 1)
PY
  then
    echo ">>> Export CSVs from SQLite"
    python scripts/export_sqlite_for_dashboard.py
    IMPORT_OK=true
  else
    echo "WARN: Oracle ETL failed — falling back to existing CSV exports."
    USE_CSV=true
  fi
fi

if [ "$USE_CSV" = "true" ]; then
  if [ ! -f municipal_analysis/RECEIPTS.csv ]; then
    echo "ERROR: No Oracle data and no municipal_analysis/RECEIPTS.csv found."
    exit 1
  fi
  echo ">>> Using municipal_analysis CSV exports (no Oracle ETL)"
  export ORACLE_ENABLED=false
fi

echo ">>> Run structured analysis"
python run_analysis.py || echo "WARN: run_analysis.py had issues (continuing)"

echo ">>> Build dashboard JSON + payment ledger"
python scripts/build_dashboard_json.py

if [ -f dashboard/data/kehale.json ]; then
  echo "Dashboard data OK: $(wc -c < dashboard/data/kehale.json) bytes kehale.json"
fi
if [ -f dashboard/data/payments.json ]; then
  echo "Payment ledger OK: $(wc -c < dashboard/data/payments.json) bytes payments.json"
fi

echo "=== Pipeline complete ==="
echo "Dashboard: http://localhost:8080"

if [ "${KEEP_ALIVE:-true}" = "true" ]; then
  echo "Analytics container ready (re-run: docker compose exec analytics /app/docker/entrypoint.sh)"
  tail -f /dev/null
fi
