"""Database access — SQLite cache and optional Oracle live connection."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pandas as pd

from .config import load_config, project_root


def sqlite_path(config: dict[str, Any] | None = None) -> Path:
    cfg = config or load_config()
    rel = cfg["database"]["sqlite_path"]
    path = project_root() / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def get_sqlite_connection(config: dict[str, Any] | None = None) -> sqlite3.Connection:
    path = sqlite_path(config)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def get_oracle_connection(config: dict[str, Any] | None = None):
    cfg = config or load_config()
    ora = cfg["database"]["oracle"]
    if not ora.get("enabled"):
        raise RuntimeError("Oracle connection is disabled in config.yaml")

    import oracledb

    return oracledb.connect(user=ora["user"], password=ora["password"], dsn=ora["dsn"])


def read_table(
    table: str,
    config: dict[str, Any] | None = None,
    where: str | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    cfg = config or load_config()
    sql = f'SELECT * FROM "{table}"'
    if where:
        sql += f" WHERE {where}"
    if limit:
        sql += f" FETCH FIRST {limit} ROWS ONLY"

    if cfg["database"]["oracle"].get("enabled"):
        with get_oracle_connection(cfg) as conn:
            return pd.read_sql(sql, conn)

    conn = get_sqlite_connection(cfg)
    try:
        q = f"SELECT * FROM {table}"
        if where:
            q += f" WHERE {where}"
        if limit:
            q += f" LIMIT {limit}"
        return pd.read_sql(q, conn)
    finally:
        conn.close()


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? COLLATE NOCASE",
        (table,),
    )
    return cur.fetchone() is not None


def list_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]
