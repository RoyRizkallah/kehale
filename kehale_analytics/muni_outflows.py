"""Municipal outflow payments (money paid BY the municipality).

Source: MBS_PAYMENTS
  + MBS_ACCEPTANCES (beneficiary via ACCEPT_SEQ_YR)
  + optional MBS_PAY_ORDER / MBS_CASH_DETAIL (check #)
Not taxpayer fee collections (RECEIPTS / FEE_TYPES).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from .exchange_rates import resolve_rates
from .payments import DATA_DIR, RATES_BDL, _clean_str

PAY_TYPE_LABELS = {
    "H": "Cash/transfer",
    "C": "Cheque",
    "Q": "Cheque",
    "K": "Cheque",
}


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

    accept = _read_csv_optional(base / "MBS_ACCEPTANCES.csv")
    orders = _read_csv_optional(base / "MBS_PAY_ORDER.csv")
    cash = _read_csv_optional(base / "MBS_CASH_DETAIL.csv")

    pay = pay.copy()
    pay["BUDGET_YEAR"] = pd.to_numeric(pay.get("BUDGET_YEAR"), errors="coerce")
    pay["AMOUNT"] = pd.to_numeric(pay.get("AMOUNT"), errors="coerce").fillna(0)
    pay["PAYMENT_SEQ_YR"] = pd.to_numeric(pay.get("PAYMENT_SEQ_YR"), errors="coerce")
    pay["ACCEPT_SEQ_YR"] = pd.to_numeric(pay.get("ACCEPT_SEQ_YR"), errors="coerce")
    pay["PAY_DATE"] = pd.to_datetime(pay.get("PAY_DATE"), errors="coerce")
    if "ENTRY_DATE" in pay.columns:
        pay["ENTRY_DATE"] = pd.to_datetime(pay["ENTRY_DATE"], errors="coerce")
    if "ACTIVE" in pay.columns:
        inactive = pay["ACTIVE"].astype(str).str.upper().isin(["N", "0", "FALSE"])
        pay = pay[~inactive]

    # Primary beneficiary source: acceptances linked by ACCEPT_SEQ_YR.
    if not accept.empty:
        accept = accept.copy()
        accept["BUDGET_YEAR"] = pd.to_numeric(accept.get("BUDGET_YEAR"), errors="coerce")
        accept["ACCEPT_SEQ_YR"] = pd.to_numeric(accept.get("ACCEPT_SEQ_YR"), errors="coerce")
        keep = [c for c in ["BUDGET_YEAR", "ACCEPT_SEQ_YR", "BENEFICIARY"] if c in accept.columns]
        accept = accept[keep].drop_duplicates(["BUDGET_YEAR", "ACCEPT_SEQ_YR"])
        accept = accept.rename(columns={"BENEFICIARY": "BENEFICIARY_ACCEPT"})
        pay = pay.merge(accept, on=["BUDGET_YEAR", "ACCEPT_SEQ_YR"], how="left")

    # Fallback: rare treasury pay-orders keyed by PAYMENT_SEQ_YR.
    if not orders.empty:
        orders = orders.copy()
        orders["BUDGET_YEAR"] = pd.to_numeric(orders.get("BUDGET_YEAR"), errors="coerce")
        orders["PAYMENT_SEQ_YR"] = pd.to_numeric(orders.get("PAYMENT_SEQ_YR"), errors="coerce")
        keep = [
            c
            for c in ["BUDGET_YEAR", "PAYMENT_SEQ_YR", "BENEFICIARY", "NOTES", "CHECK_NUM"]
            if c in orders.columns
        ]
        orders = orders[keep].drop_duplicates(["BUDGET_YEAR", "PAYMENT_SEQ_YR"])
        orders = orders.rename(
            columns={
                "BENEFICIARY": "BENEFICIARY_ORDER",
                "CHECK_NUM": "CHECK_NUM_ORDER",
            }
        )
        pay = pay.merge(orders, on=["BUDGET_YEAR", "PAYMENT_SEQ_YR"], how="left")

    # Cheque details (when PAY_TYPE is cheque / cash detail exists).
    if not cash.empty and "PAYMENT_SEQ_YR" in cash.columns:
        cash = cash.copy()
        cash["BUDGET_YEAR"] = pd.to_numeric(cash.get("BUDGET_YEAR"), errors="coerce")
        cash["PAYMENT_SEQ_YR"] = pd.to_numeric(cash.get("PAYMENT_SEQ_YR"), errors="coerce")
        cash["CHECK_NUM"] = cash.get("CHECK_NUM")
        # Prefer first non-null check per payment.
        agg_map: dict[str, tuple[str, str]] = {"CHECK_NUM_CASH": ("CHECK_NUM", "first")}
        if "CHECK_PAYOR" in cash.columns:
            agg_map["CHECK_PAYOR"] = ("CHECK_PAYOR", "first")
        cash = (
            cash.dropna(subset=["PAYMENT_SEQ_YR"])
            .sort_values(["BUDGET_YEAR", "PAYMENT_SEQ_YR"])
            .groupby(["BUDGET_YEAR", "PAYMENT_SEQ_YR"], as_index=False)
            .agg(**agg_map)
        )
        pay = pay.merge(cash, on=["BUDGET_YEAR", "PAYMENT_SEQ_YR"], how="left")

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
        accept_seq = int(r["ACCEPT_SEQ_YR"]) if pd.notna(r.get("ACCEPT_SEQ_YR")) else None
        beneficiary = (
            _clean_str(r.get("BENEFICIARY_ACCEPT"))
            or _clean_str(r.get("BENEFICIARY_ORDER"))
            or _clean_str(r.get("CHECK_PAYOR"))
        )
        check_num = (
            _clean_str(r.get("CHECK_NUM"))
            or _clean_str(r.get("CHECK_NUM_CASH"))
            or _clean_str(r.get("CHECK_NUM_ORDER"))
        )
        pay_type = _clean_str(r.get("PAY_TYPE"))
        ledger.append({
            "source": "muni_outflow",
            "payment_seq_yr": seq,
            "accept_seq_yr": accept_seq,
            "date": date_str,
            "budget_year": yr,
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "pay_type": pay_type,
            "pay_type_label": PAY_TYPE_LABELS.get(pay_type, pay_type or "—"),
            "check_num": check_num,
            "cashier": _clean_str(r.get("CASHIER")),
            "beneficiary": beneficiary,
            "notes": _clean_str(r.get("NOTES")),
            "expense_auth_by": _clean_str(r.get("EXPENSE_AUTH_BY")),
            "pay_auth_by": _clean_str(r.get("PAY_AUTH_BY")),
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
