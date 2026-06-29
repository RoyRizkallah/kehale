#!/bin/bash
# Import Oracle classic exp dump into XE PDB for Kehale analytics
set -euo pipefail

DUMP_FILE="${DUMP_FILE:-/dump/MONDAY_165.DMP}"
ORACLE_PWD="${ORACLE_PASSWORD:-Kehale2026!}"

echo "Waiting for Oracle to be ready..."
until echo "SELECT 1 FROM DUAL;" | sqlplus -s system/"${ORACLE_PWD}"@//localhost:1521/XE | grep -q "1"; do
  sleep 10
done

echo "Creating tablespace and users..."
sqlplus -s system/"${ORACLE_PWD}"@//localhost:1521/XE <<'SQL'
WHENEVER SQLERROR CONTINUE
CREATE TABLESPACE USERS DATAFILE '/opt/oracle/oradata/XE/users01.dbf' SIZE 500M AUTOEXTEND ON;
CREATE TABLESPACE INDX DATAFILE '/opt/oracle/oradata/XE/indx01.dbf' SIZE 200M AUTOEXTEND ON;
CREATE USER RUSUM IDENTIFIED BY rusum DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
CREATE USER MBSSMALL IDENTIFIED BY mbssmall DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
CREATE USER MAS IDENTIFIED BY mas DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
CREATE USER COMAPP IDENTIFIED BY commapp DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
GRANT CONNECT, RESOURCE, DBA TO RUSUM;
GRANT CONNECT, RESOURCE, DBA TO MBSSMALL;
GRANT CONNECT, RESOURCE, DBA TO MAS;
GRANT CONNECT, RESOURCE, DBA TO COMAPP;
EXIT;
SQL

IMP_BIN=$(find /opt/oracle -name imp -type f 2>/dev/null | head -1)
if [ -z "$IMP_BIN" ]; then
  echo "ERROR: Oracle imp utility not found. Classic exp dumps require imp from Oracle client."
  exit 1
fi

echo "Importing dump with imp (this may take 15-30 minutes)..."
"$IMP_BIN" system/"${ORACLE_PWD}"@//localhost:1521/XE \
  FILE="${DUMP_FILE}" \
  FULL=Y \
  IGNORE=Y \
  LOG=/tmp/imp_kehale.log \
  STATISTICS=NONE

echo "Import complete. Log: /tmp/imp_kehale.log"
