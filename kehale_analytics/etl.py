"""ETL: Oracle → SQLite and dump metadata extraction."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pandas as pd

from .config import load_config, project_root
from .db import get_oracle_connection, get_sqlite_connection, sqlite_path

# Core tables for municipal revenue / budget analysis
# schema prefix required when connecting as SYSTEM (Docker ETL)
TABLE_SCHEMA: dict[str, str] = {
    "BALADIAT": "RUSUM",
    "BALADIEH_YEARS": "RUSUM",
    "MBS_BUD_YEARS": "MBSSMALL",
    "MBS_EXCHANGE_ACCOUNT": "MBSSMALL",
    "MBS_EXCHANGE_ACCOUNT_LOG": "MBSSMALL",
    "MONEY_UNITS": "RUSUM",
    "FEE_TYPES": "RUSUM",
    "RECEIPTS": "RUSUM",
    "RECEIPTS_DET": "RUSUM",
    "RECEIPTS_CHECKS": "RUSUM",
    "MRS_PAY_TRANS": "RUSUM",
    "MRS_PAY_TRANSACTIONS": "RUSUM",
    "TAKLEEFAT": "RUSUM",
    "COLLECTION_ORDER": "RUSUM",
    "MBS_PAYMENTS": "MBSSMALL",
    "MBS_PAY_TRANSACTIONS": "MBSSMALL",
    "MBS_INCOMES_BUD": "MBSSMALL",
    "MBS_EXPENSES_BUD": "MBSSMALL",
    "MBS_BUD_PLANS": "MBSSMALL",
    "MBS_BUD_PLAN_INCOMES": "MBSSMALL",
    "RUSUM_APPL_PARAMETERS": "RUSUM",
    "MUKALLAF": "RUSUM",
    "STATEMENTS": "RUSUM",
}

CORE_TABLES = list(TABLE_SCHEMA.keys())


def _qualified_table(table: str) -> str:
    schema = TABLE_SCHEMA.get(table)
    if schema:
        return f'"{schema}"."{table}"'
    return f'"{table}"'


def export_oracle_to_sqlite(
    config: dict[str, Any] | None = None,
    tables: list[str] | None = None,
) -> dict[str, int]:
    """Pull tables from Oracle into local SQLite cache."""
    cfg = config or load_config()
    targets = tables or CORE_TABLES
    counts: dict[str, int] = {}

    with get_oracle_connection(cfg) as ora_conn, get_sqlite_connection(cfg) as lite_conn:
        for table in targets:
            try:
                qtable = _qualified_table(table)
                df = pd.read_sql(f"SELECT * FROM {qtable}", ora_conn)
                df.to_sql(table, lite_conn, if_exists="replace", index=False)
                counts[table] = len(df)
            except Exception as exc:
                counts[table] = -1
                print(f"WARN: could not export {table}: {exc}")

    return counts


def init_sqlite_from_dump_parser(config: dict[str, Any] | None = None) -> dict[str, int]:
    """Fallback: parse key tables directly from .DMP binary."""
    from .dump_parser import parse_core_tables

    cfg = config or load_config()
    dump = project_root() / cfg["dump"]["path"]
    parsed = parse_core_tables(dump)

    with get_sqlite_connection(cfg) as conn:
        counts = {}
        for table, df in parsed.items():
            if df is not None and not df.empty:
                df.to_sql(table, conn, if_exists="replace", index=False)
                counts[table] = len(df)
        return counts


def ensure_data(config: dict[str, Any] | None = None) -> str:
    """Load data into SQLite from Oracle if enabled, else dump parser."""
    cfg = config or load_config()
    path = sqlite_path(cfg)

    if cfg["database"]["oracle"].get("enabled"):
        export_oracle_to_sqlite(cfg)
        return f"oracle→sqlite ({path})"

    if not path.exists() or path.stat().st_size < 1024:
        init_sqlite_from_dump_parser(cfg)
        return f"dump-parser→sqlite ({path})"

    return f"existing sqlite ({path})"
