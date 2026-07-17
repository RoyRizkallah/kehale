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
               ACCEPT_DATE, RESERVE_SEQ_YR, BENEFICIARY, EMPLOYEE, ACTIVE
        FROM MBSSMALL.MBS_ACCEPTANCES
    """,
    "MBS_ACCEPT_DETAILS.csv": """
        SELECT BALADIEH_INTID, BUDGET_YEAR, ACCEPT_SEQ_YR, ACC_DETAIL_SEQ,
               DESCRIPTION, AMOUNT
        FROM MBSSMALL.MBS_ACCEPT_DETAILS
    """,
    "MBS_RESERVES.csv": """
        SELECT BALADIEH_INTID, BUDGET_YEAR, RESERVE_SEQ_YR, RESERVE_SEQ,
               BUDGET_TYPE, DESCRIPT, CHAPTER, SECTION, RESERVE_DATE,
               APPROVED_AMT, ACTIVE
        FROM MBSSMALL.MBS_RESERVES
    """,
    "MBS_CHAPTERS.csv": """
        SELECT CHAPTER_TYPE, CHAPTER, DESCRIPT, BUDGET_YEAR
        FROM MBSSMALL.MBS_CHAPTERS
    """,
    "MBS_SECTIONS.csv": """
        SELECT CHAPTER_TYPE, CHAPTER, SECTION, DESCRIPT, BUDGET_YEAR
        FROM MBSSMALL.MBS_SECTIONS
    """,
    "MBS_PARAGRAPH.csv": """
        SELECT CHAPTER_TYPE, CHAPTER, SECTION, PARAGRAPH, DESCRIPT, BUDGET_YEAR
        FROM MBSSMALL.MBS_PARAGRAPH
    """,
    "MBS_CASH_DETAIL.csv": """
        SELECT BALADIEH_INTID, BUDGET_YEAR, CASH_SEQ, CASH_TYPE, PAYMENT_SEQ_YR,
               DTL_AMOUNT, CHECK_NUM, CHECK_DATE, CHECK_PAYOR, BANK_CODE
        FROM MBSSMALL.MBS_CASH_DETAIL
    """,
    "FEE_TANSSIB_ACCOUNT.csv": """
        SELECT FTA_ID, FEE_TYPE, FEE_TYPE_ID, FEE_TYPE_DET, FEE_DETAIL,
               DESCRIPTION, TANSSIB, ACCOUNT, IS_5595, FROM_YEAR, TILL_YEAR
        FROM RUSUM.FEE_TANSSIB_ACCOUNT
    """,
    "FEE_TANSSIB_ACCOUNT_DESC.csv": """
        SELECT FTA_ID, TANSSIB_CODE, TANSSIB_DESC, PART_CODE, PART_DESC,
               CHAPTER_CODE, CHAPTER_DESC, SECTION_CODE, SECTION_DESC,
               PARAGRAPH_CODE, PARAGRAPH_DESC
        FROM RUSUM.FEE_TANSSIB_ACCOUNT_DESC
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
