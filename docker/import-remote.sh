#!/bin/bash
# Run Oracle imp import from a sidecar container (connects to oracle service)
set -euo pipefail

MARKER="${ORACLE_IMPORT_MARKER:-/data/.oracle_import_done}"
if [ -f "$MARKER" ]; then
  echo "Import already completed ($MARKER exists). Skipping."
  exit 0
fi

# Slim image may not put Oracle bin / findutils on PATH
export ORACLE_HOME="${ORACLE_HOME:-/opt/oracle/product/21c/dbhomeXE}"
export PATH="${ORACLE_HOME}/bin:/usr/bin:/bin:${PATH:-}"

HOST="${ORACLE_HOST:-oracle}"
PASS="${ORACLE_PASSWORD:-Kehale2026!}"
CONN="system/${PASS}@//${HOST}:1521/XE"
MAX_WAIT="${ORACLE_MAX_WAIT:-600}"
SQLPLUS="${ORACLE_HOME}/bin/sqlplus"
if [ ! -x "$SQLPLUS" ]; then
  SQLPLUS=$(command -v sqlplus || true)
fi
if [ -z "$SQLPLUS" ]; then
  echo "ERROR: sqlplus not found."
  exit 1
fi

echo "Waiting for Oracle at ${HOST}..."
elapsed=0
while [ "$elapsed" -lt "$MAX_WAIT" ]; do
  if echo "SELECT 1 FROM DUAL;" | "$SQLPLUS" -s "$CONN" | grep -q "1"; then
    echo "Oracle is ready."
    break
  fi
  sleep 10
  elapsed=$((elapsed + 10))
done
if [ "$elapsed" -ge "$MAX_WAIT" ]; then
  echo "ERROR: Oracle not ready."
  exit 1
fi

IMP_BIN=""
for cand in \
  /opt/oracle/product/21c/dbhomeXE/bin/imp \
  /opt/oracle/product/18c/dbhomeXE/bin/imp \
  /u01/app/oracle/product/*/dbhomeXE/bin/imp
do
  if [ -x "$cand" ]; then
    IMP_BIN="$cand"
    break
  fi
done
if [ -z "$IMP_BIN" ]; then
  # Fallback without relying on find (not present in slim image PATH)
  IMP_BIN=$(ls /opt/oracle/product/*/dbhomeXE/bin/imp 2>/dev/null | head -1 || true)
fi
if [ -z "$IMP_BIN" ] || [ ! -x "$IMP_BIN" ]; then
  echo "ERROR: imp utility not found in this image."
  exit 1
fi
echo "Using imp: $IMP_BIN"

echo "Creating users and tablespaces..."
"$SQLPLUS" -s "$CONN" <<'SQL'
WHENEVER SQLERROR CONTINUE
CREATE TABLESPACE USERS DATAFILE '/opt/oracle/oradata/XE/users01.dbf' SIZE 500M AUTOEXTEND ON MAXSIZE 8G;
CREATE TABLESPACE INDX DATAFILE '/opt/oracle/oradata/XE/indx01.dbf' SIZE 200M AUTOEXTEND ON MAXSIZE 4G;
CREATE USER RUSUM IDENTIFIED BY rusum DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
CREATE USER MBSSMALL IDENTIFIED BY mbssmall DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
GRANT CONNECT, RESOURCE, DBA TO RUSUM;
GRANT CONNECT, RESOURCE, DBA TO MBSSMALL;
EXIT;
SQL

DUMP="${DUMP_FILE:-/dump/MONDAY_165.DMP}"
for pair in "RUSUM RUSUM" "MBSSMALL MBSSMALL"; do
  set -- $pair
  echo "Importing schema $1 → $2 ..."
  "$IMP_BIN" "$CONN" FILE="$DUMP" FROMUSER="$1" TOUSER="$2" IGNORE=Y STATISTICS=NONE \
    || echo "WARN: import $1 returned non-zero (may be partial if re-run)"
done

touch "$MARKER"
echo "Import finished. Marker: $MARKER"
