"""Export municipal payment tables from local Docker Oracle to CSV."""
from __future__ import annotations

from pathlib import Path

import oracledb
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "municipal_analysis"
DSN = "localhost:1521/XE"
USER = "system"
PASSWORD = "Kehale2026!"

QUERIES = {
    "MBS_PAYMENTS.csv": """
        SELECT BALADIEH_INTID, BUDGET_YEAR, PAYMENT_SEQ_YR, ACCEPT_SEQ_YR,
               ENTRY_DATE, PAY_TYPE, CHECK_NUM, PAY_DATE, AMOUNT, CASHIER,
               PRINTED, USER_ID, TRANS_DATE, EXPENSE_AUTH_BY, PAY_AUTH_BY,
               CASHING_DATE, ACTIVE, INACTIVE_REASON, INACTIVE_DATE,
               CHECK_DATE, TREASURY_RECEIPT_DATE, PARAGRAPH
        FROM MBSSMALL.MBS_PAYMENTS
    """,
    "MBS_PAY_ORDER.csv": """
        SELECT BALADIEH_INTID, BUDGET_YEAR, PAYMENT_SEQ_YR, BENEFICIARY, NOTES,
               EXPENSE_AUTH_BY, ENTRY_DATE, PAY_AUTH_BY, PAY_DATE, AMOUNT,
               PAY_TYPE, CHECK_NUM, CASHIER, CASHING_DATE, PRINTED, USER_ID,
               TRANS_DATE, ACTIVE, INACTIVE_REASON, INACTIVE_DATE
        FROM MBSSMALL.MBS_PAY_ORDER
    """,
    "MBS_ACCEPTANCES.csv": """
        SELECT BALADIEH_INTID, BUDGET_YEAR, ACCEPT_SEQ_YR, ACCEPT_SEQ,
               ACCEPT_DATE, BENEFICIARY, EMPLOYEE, ACTIVE
        FROM MBSSMALL.MBS_ACCEPTANCES
    """,
    "MBS_CASH_DETAIL.csv": """
        SELECT BALADIEH_INTID, BUDGET_YEAR, CASH_SEQ, CASH_TYPE, PAYMENT_SEQ_YR,
               DTL_AMOUNT, CHECK_NUM, CHECK_DATE, CHECK_PAYOR, BANK_CODE
        FROM MBSSMALL.MBS_CASH_DETAIL
    """,
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
