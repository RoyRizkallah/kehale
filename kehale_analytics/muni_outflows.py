"""Municipal outflow payments (money paid BY the municipality).

Source: MBS_PAYMENTS (+ optional MBS_PAY_ORDER for beneficiary).
Not taxpayer fee collections (RECEIPTS / FEE_TYPES).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from .exchange_rates import resolve_rates
from .payments import DATA_DIR, RATES_BDL, _clean_str


def _read_csv_optional(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, low_memory=False)


def build_muni_payment_ledger(data_dir: Path | None = None) -> list[dict[str, Any]]:
    """One record per MBS_PAYMENTS row. Empty list if export missing."""
    base = data_dir or DATA_DIR
    pay = _read_csv_optional(base / "MBS_PAYMENTS.csv")
    if pay.empty:
        return []

    orders = _read_csv_optional(base / "MBS_PAY_ORDER.csv")

    pay = pay.copy()
    pay["BUDGET_YEAR"] = pd.to_numeric(pay.get("BUDGET_YEAR"), errors="coerce")
    pay["AMOUNT"] = pd.to_numeric(pay.get("AMOUNT"), errors="coerce").fillna(0)
    pay["PAYMENT_SEQ_YR"] = pd.to_numeric(pay.get("PAYMENT_SEQ_YR"), errors="coerce")
    pay["PAY_DATE"] = pd.to_datetime(pay.get("PAY_DATE"), errors="coerce")
    if "ENTRY_DATE" in pay.columns:
        pay["ENTRY_DATE"] = pd.to_datetime(pay["ENTRY_DATE"], errors="coerce")
    if "ACTIVE" in pay.columns:
        inactive = pay["ACTIVE"].astype(str).str.upper().isin(["N", "0", "FALSE"])
        pay = pay[~inactive]

    if not orders.empty:
        orders = orders.copy()
        orders["BUDGET_YEAR"] = pd.to_numeric(orders.get("BUDGET_YEAR"), errors="coerce")
        orders["PAYMENT_SEQ_YR"] = pd.to_numeric(orders.get("PAYMENT_SEQ_YR"), errors="coerce")
        keep = [
            c
            for c in ["BUDGET_YEAR", "PAYMENT_SEQ_YR", "BENEFICIARY", "NOTES"]
            if c in orders.columns
        ]
        orders = orders[keep].drop_duplicates(["BUDGET_YEAR", "PAYMENT_SEQ_YR"])
        pay = pay.merge(orders, on=["BUDGET_YEAR", "PAYMENT_SEQ_YR"], how="left")

    years = sorted(pay["BUDGET_YEAR"].dropna().astype(int).unique().tolist())
    rates_df = resolve_rates(
        years or [2025],
        {
            "exchange_rates": {
                "bdl_official": RATES_BDL,
                "overrides": {},
                "source_priority": ["bdl_official"],
            }
        },
    )
    rate_lu = rates_df.set_index("year")["lbp_per_usd"]

    ledger: list[dict[str, Any]] = []
    for _, r in pay.iterrows():
        yr = int(r["BUDGET_YEAR"]) if pd.notna(r.get("BUDGET_YEAR")) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        amt = float(r["AMOUNT"] or 0)
        pay_date = r.get("PAY_DATE")
        date_str = pay_date.strftime("%Y-%m-%d") if pd.notna(pay_date) else None
        if not date_str and pd.notna(r.get("ENTRY_DATE")):
            date_str = r["ENTRY_DATE"].strftime("%Y-%m-%d")

        seq = int(r["PAYMENT_SEQ_YR"]) if pd.notna(r.get("PAYMENT_SEQ_YR")) else None
        ledger.append({
            "source": "muni_outflow",
            "payment_seq_yr": seq,
            "date": date_str,
            "budget_year": yr,
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "pay_type": _clean_str(r.get("PAY_TYPE")),
            "check_num": _clean_str(r.get("CHECK_NUM")),
            "cashier": _clean_str(r.get("CASHIER")),
            "beneficiary": _clean_str(r.get("BENEFICIARY")) if "BENEFICIARY" in r.index else "",
            "notes": _clean_str(r.get("NOTES")) if "NOTES" in r.index else "",
            "user_id": _clean_str(r.get("USER_ID")),
            "paragraph": int(r["PARAGRAPH"]) if pd.notna(r.get("PARAGRAPH")) else None,
        })

    ledger.sort(key=lambda x: (x["date"] or "", x["payment_seq_yr"] or 0), reverse=True)
    return ledger


def muni_payments_yearly_summary(
    ledger: list[dict[str, Any]],
    rates_df: pd.DataFrame | None = None,
) -> list[dict[str, Any]]:
    """Aggregate municipal outflows by budget year."""
    if not ledger:
        return []
    df = pd.DataFrame(ledger)
    if df.empty:
        return []
    years = sorted(df["budget_year"].dropna().astype(int).unique().tolist())
    if rates_df is None:
        rates_df = resolve_rates(
            years or [2025],
            {
                "exchange_rates": {
                    "bdl_official": RATES_BDL,
                    "overrides": {},
                    "source_priority": ["bdl_official"],
                }
            },
        )
    rate_lu = rates_df.set_index("year")["lbp_per_usd"]
    rows = []
    for yr, g in df.groupby("budget_year"):
        if pd.isna(yr):
            continue
        y = int(yr)
        rate = float(rate_lu.get(y, 1507.5))
        total = float(g["amount_lbp"].sum())
        rows.append({
            "year": y,
            "paid_out_count": int(len(g)),
            "paid_out_lbp": round(total, 2),
            "paid_out_usd": round(total / rate, 2),
        })
    return sorted(rows, key=lambda r: r["year"])
