"""Structured revenue analysis with USD normalization."""

from __future__ import annotations

from typing import Any

import pandas as pd

from ..db import get_sqlite_connection, table_exists
from ..exchange_rates import resolve_rates, to_usd


def _safe_read(conn, table: str) -> pd.DataFrame:
    if not table_exists(conn, table):
        return pd.DataFrame()
    return pd.read_sql(f"SELECT * FROM {table}", conn)


def revenue_by_year(config: dict[str, Any], rates: pd.DataFrame) -> pd.DataFrame:
    with get_sqlite_connection(config) as conn:
        receipts = _safe_read(conn, "RECEIPTS")

    if receipts.empty:
        est = _safe_read(get_sqlite_connection(config), "_RECEIPTS_SUMMARY_EST")
        if est.empty:
            return pd.DataFrame(
                columns=[
                    "year",
                    "receipt_count",
                    "total_lbp",
                    "total_usd",
                    "avg_receipt_lbp",
                    "avg_receipt_usd",
                    "lbp_per_usd",
                    "rate_source",
                ]
            )
        est = est.rename(columns={"BUDGET_YEAR": "year"})
        est["total_lbp"] = est.get("RECEIPT_AMOUNT_LBP_EST", 0)
        est["receipt_count"] = est.get("RECEIPT_COUNT_EST", 0)
        merged = est.merge(rates, left_on="year", right_on="year", how="left")
        merged["total_usd"] = merged["total_lbp"] / merged["lbp_per_usd"]
        return merged[
            [
                "year",
                "receipt_count",
                "total_lbp",
                "total_usd",
                "lbp_per_usd",
                "source",
            ]
        ].rename(columns={"source": "rate_source"})

    receipts["BUDGET_YEAR"] = receipts["BUDGET_YEAR"].astype(int)
    receipts["RECEIPT_AMOUNT"] = pd.to_numeric(
        receipts["RECEIPT_AMOUNT"], errors="coerce"
    ).fillna(0)
    receipts["RECEIPT_FINE_AMOUNT"] = pd.to_numeric(
        receipts.get("RECEIPT_FINE_AMOUNT", 0), errors="coerce"
    ).fillna(0)
    receipts["total_line_lbp"] = (
        receipts["RECEIPT_AMOUNT"] + receipts["RECEIPT_FINE_AMOUNT"]
    )

    agg = (
        receipts.groupby("BUDGET_YEAR", as_index=False)
        .agg(
            receipt_count=("RECEIPT_ID", "count"),
            total_lbp=("total_line_lbp", "sum"),
            avg_receipt_lbp=("total_line_lbp", "mean"),
        )
        .rename(columns={"BUDGET_YEAR": "year"})
    )

    merged = agg.merge(rates, on="year", how="left")
    merged["total_usd"] = to_usd(merged["total_lbp"], merged["year"], rates)
    merged["avg_receipt_usd"] = to_usd(merged["avg_receipt_lbp"], merged["year"], rates)
    merged = merged.rename(columns={"source": "rate_source"})
    return merged[
        [
            "year",
            "receipt_count",
            "total_lbp",
            "total_usd",
            "avg_receipt_lbp",
            "avg_receipt_usd",
            "lbp_per_usd",
            "rate_source",
        ]
    ]


def revenue_by_fee_type(config: dict[str, Any], rates: pd.DataFrame) -> pd.DataFrame:
    with get_sqlite_connection(config) as conn:
        takleef = _safe_read(conn, "TAKLEEFAT")
        fees = _safe_read(conn, "FEE_TYPES")

    if takleef.empty:
        return pd.DataFrame()

    takleef["BUDGET_YEAR"] = takleef["BUDGET_YEAR"].astype(int)
    takleef["TAKLEEF_AMOUNT"] = pd.to_numeric(
        takleef["TAKLEEF_AMOUNT"], errors="coerce"
    ).fillna(0)

    agg = (
        takleef.groupby(["BUDGET_YEAR", "FEE_TYPE_ID"], as_index=False)
        .agg(
            charge_count=("TAKLEEF_ID", "count"),
            total_lbp=("TAKLEEF_AMOUNT", "sum"),
            paid_count=("PAID", lambda s: (s == "Y").sum()),
        )
        .rename(columns={"BUDGET_YEAR": "year"})
    )

    if not fees.empty:
        agg = agg.merge(
            fees[["FEE_TYPE_ID", "FEE_TYPE_NAME"]],
            on="FEE_TYPE_ID",
            how="left",
        )

    agg["total_usd"] = to_usd(agg["total_lbp"], agg["year"], rates)
    agg["collection_rate_pct"] = (agg["paid_count"] / agg["charge_count"] * 100).round(
        2
    )
    return agg.sort_values(["year", "total_usd"], ascending=[True, False])


def payment_transactions_summary(
    config: dict[str, Any], rates: pd.DataFrame
) -> pd.DataFrame:
    with get_sqlite_connection(config) as conn:
        trans = _safe_read(conn, "MRS_PAY_TRANS")
        trans_det = _safe_read(conn, "MRS_PAY_TRANSACTIONS")

    if trans.empty or trans_det.empty:
        return pd.DataFrame()

    trans["BUDGET_YEAR"] = trans["BUDGET_YEAR"].astype(int)
    trans_det["AMOUNT"] = pd.to_numeric(trans_det["AMOUNT"], errors="coerce").fillna(0)

    merged = trans_det.merge(
        trans[["PAY_TRANS_ID", "BUDGET_YEAR", "TRANSACTION_DATE"]],
        on="PAY_TRANS_ID",
        how="inner",
    )

    agg = (
        merged.groupby("BUDGET_YEAR", as_index=False)
        .agg(
            transaction_lines=("AMOUNT", "count"),
            total_lbp=("AMOUNT", "sum"),
        )
        .rename(columns={"BUDGET_YEAR": "year"})
    )
    agg["total_usd"] = to_usd(agg["total_lbp"], agg["year"], rates)
    return agg


def budget_summary(config: dict[str, Any], rates: pd.DataFrame) -> pd.DataFrame:
    with get_sqlite_connection(config) as conn:
        income = _safe_read(conn, "MBS_INCOMES_BUD")
        expense = _safe_read(conn, "MBS_EXPENSES_BUD")

    rows = []
    if not income.empty:
        income["BUDGET_YEAR"] = income["BUDGET_YEAR"].astype(int)
        inc = (
            income.groupby("BUDGET_YEAR", as_index=False)
            .agg(budget_income_lbp=("BD_AMOUNT", "sum"))
            .rename(columns={"BUDGET_YEAR": "year"})
        )
        rows.append(inc)

    if not expense.empty:
        expense["BUDGET_YEAR"] = expense["BUDGET_YEAR"].astype(int)
        exp = (
            expense.groupby("BUDGET_YEAR", as_index=False)
            .agg(budget_expense_lbp=("BD_AMOUNT", "sum"))
            .rename(columns={"BUDGET_YEAR": "year"})
        )
        rows.append(exp)

    if not rows:
        return pd.DataFrame()

    out = rows[0]
    for df in rows[1:]:
        out = out.merge(df, on="year", how="outer")

    out = out.merge(rates[["year", "lbp_per_usd", "source"]], on="year", how="left")
    if "budget_income_lbp" in out.columns:
        out["budget_income_usd"] = to_usd(out["budget_income_lbp"], out["year"], rates)
    if "budget_expense_lbp" in out.columns:
        out["budget_expense_usd"] = to_usd(
            out["budget_expense_lbp"], out["year"], rates
        )
    return out.rename(columns={"source": "rate_source"})
