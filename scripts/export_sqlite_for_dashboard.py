#!/usr/bin/env python3
"""Export key SQLite tables to municipal_analysis CSVs for the dashboard."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kehale_analytics.config import project_root
from kehale_analytics.db import get_sqlite_connection, table_exists

DASHBOARD_TABLES = [
    "RECEIPTS",
    "MRS_PAY_TRANSACTIONS",
    "MRS_PAY_TRANS",
    "FEE_TYPES",
    "TAKLEEFAT",
]


def main() -> None:
    out = project_root() / "municipal_analysis"
    out.mkdir(parents=True, exist_ok=True)

    with get_sqlite_connection() as conn:
        exported = 0
        for table in DASHBOARD_TABLES:
            if not table_exists(conn, table):
                print(f"SKIP {table} (not in SQLite)")
                continue
            import pandas as pd

            df = pd.read_sql(f"SELECT * FROM {table}", conn)
            path = out / f"{table}.csv"
            df.to_csv(path, index=False, encoding="utf-8-sig")
            print(f"Wrote {path} ({len(df):,} rows)")
            exported += 1

    if exported == 0:
        raise SystemExit("No tables exported — run Oracle ETL first.")
    print(f"Exported {exported} tables to {out}")


if __name__ == "__main__":
    main()
