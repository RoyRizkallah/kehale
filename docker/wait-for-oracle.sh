#!/bin/bash
# Wait until Oracle listener accepts connections
set -euo pipefail

HOST="${ORACLE_HOST:-oracle}"
PORT="${ORACLE_PORT:-1521}"
SERVICE="${ORACLE_SERVICE:-XE}"
USER="${ORACLE_WAIT_USER:-system}"
PASS="${ORACLE_PASSWORD:-Kehale2026!}"
MAX_WAIT="${ORACLE_MAX_WAIT:-600}"

echo "Waiting for Oracle at ${HOST}:${PORT}/${SERVICE} (max ${MAX_WAIT}s)..."
elapsed=0
while [ "$elapsed" -lt "$MAX_WAIT" ]; do
  if python - <<'PY'
import os, sys
try:
    import oracledb
    dsn = f"{os.environ['ORACLE_HOST']}:{os.environ.get('ORACLE_PORT','1521')}/{os.environ.get('ORACLE_SERVICE','XE')}"
    conn = oracledb.connect(user=os.environ['ORACLE_WAIT_USER'], password=os.environ['ORACLE_PASSWORD'], dsn=dsn)
    conn.ping()
    conn.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
  then
    echo "Oracle is ready."
    exit 0
  fi
  sleep 10
  elapsed=$((elapsed + 10))
  echo "  ...still waiting (${elapsed}s)"
done

echo "ERROR: Oracle did not become ready in time."
exit 1
