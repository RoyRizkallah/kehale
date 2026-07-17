"""Export receivable tables from local Docker Oracle (RUSUM) to CSV."""
from __future__ import annotations

from pathlib import Path

import oracledb
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "municipal_analysis"
DSN = "localhost:1521/XE"
USER = "system"
PASSWORD = "Kehale2026!"

QUERIES = {
    "RECEIPTS.csv": "SELECT * FROM RUSUM.RECEIPTS",
    "MRS_PAY_TRANS.csv": "SELECT * FROM RUSUM.MRS_PAY_TRANS",
    "MRS_PAY_TRANSACTIONS.csv": "SELECT * FROM RUSUM.MRS_PAY_TRANSACTIONS",
    "FEE_TYPES.csv": "SELECT * FROM RUSUM.FEE_TYPES",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    conn = oracledb.connect(user=USER, password=PASSWORD, dsn=DSN)
    try:
        for name, sql in QUERIES.items():
            df = pd.read_sql(sql, conn)
            path = OUT / name
            df.to_csv(path, index=False, encoding="utf-8-sig")
            print(f"Wrote {path} ({len(df):,} rows)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
