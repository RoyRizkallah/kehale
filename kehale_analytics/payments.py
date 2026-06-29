"""Payment & receivables analytics from municipal CSV exports."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pandas as pd

from .exchange_rates import resolve_rates, to_usd

DATA_DIR = Path(__file__).resolve().parent.parent / "municipal_analysis"

FEETP_LABELS = {
    1: "Annual Fees",
    2: "Licenses & Permits",
    3: "Miscellaneous Revenue",
    4: "Taxes & Surcharges",
}

RATES_BDL = {
    2000: 1507.5, 2001: 1507.5, 2002: 1507.5, 2003: 1507.5, 2004: 1507.5,
    2005: 1507.5, 2006: 1507.5, 2007: 1507.5, 2008: 1507.5, 2009: 1507.5,
    2010: 1507.5, 2011: 1507.5, 2012: 1507.5, 2013: 1507.5, 2014: 1507.5,
    2015: 1507.5, 2016: 1507.5, 2017: 1507.5, 2018: 1507.5, 2019: 1507.5,
    2020: 1507.5, 2021: 1507.5, 2022: 1507.5, 2023: 89500.0, 2024: 89500.0,
    2025: 89500.0, 2026: 89500.0,
}


def _load_pay_trans(data_dir: Path | None = None) -> pd.DataFrame:
    path = (data_dir or DATA_DIR) / "MRS_PAY_TRANS.csv"
    rows: list[dict[str, str]] = []
    with path.open(encoding="utf-8-sig", errors="replace") as f:
        for row in csv.DictReader(f):
            pid = (row.get("PAY_TRANS_ID") or "").strip()
            if pid.isdigit():
                rows.append(row)
    df = pd.DataFrame(rows)
    df["PAY_TRANS_ID"] = df["PAY_TRANS_ID"].astype(int)
    df["BUDGET_YEAR"] = pd.to_numeric(df["BUDGET_YEAR"], errors="coerce")
    df["TRANSACTION_DATE"] = pd.to_datetime(df["TRANSACTION_DATE"], errors="coerce")
    return df


def load_payment_data(data_dir: Path | None = None) -> dict[str, pd.DataFrame]:
    base = data_dir or DATA_DIR
    receipts = pd.read_csv(base / "RECEIPTS.csv", low_memory=False)
    receipts["BUDGET_YEAR"] = pd.to_numeric(receipts["BUDGET_YEAR"], errors="coerce")
    receipts["RECEIPT_AMOUNT"] = pd.to_numeric(
        receipts["RECEIPT_AMOUNT"], errors="coerce"
    ).fillna(0)
    receipts["RECEIPT_FINE_AMOUNT"] = pd.to_numeric(
        receipts.get("RECEIPT_FINE_AMOUNT"), errors="coerce"
    ).fillna(0)
    receipts["total_lbp"] = receipts["RECEIPT_AMOUNT"] + receipts["RECEIPT_FINE_AMOUNT"]
    receipts["RECEIPT_DATE"] = pd.to_datetime(receipts["RECEIPT_DATE"], errors="coerce")

    trans = pd.read_csv(base / "MRS_PAY_TRANSACTIONS.csv")
    trans["PAY_TRANS_ID"] = pd.to_numeric(trans["PAY_TRANS_ID"], errors="coerce")
    trans["AMOUNT"] = pd.to_numeric(trans["AMOUNT"], errors="coerce").fillna(0)
    trans["FEE_TYPE_ID"] = pd.to_numeric(trans["FEE_TYPE_ID"], errors="coerce")

    pay_trans = _load_pay_trans(base)
    merged = trans.merge(
        pay_trans[
            ["PAY_TRANS_ID", "BUDGET_YEAR", "TRANSACTION_DATE", "MUKALLAF_NAME"]
        ],
        on="PAY_TRANS_ID",
        how="inner",
    )

    fees = pd.read_csv(base / "FEE_TYPES.csv")
    fees["FEE_TYPE_ID"] = pd.to_numeric(fees["FEE_TYPE_ID"], errors="coerce")
    fees["FEETP"] = pd.to_numeric(fees.get("FEETP"), errors="coerce").fillna(3)

    return {
        "receipts": receipts,
        "transactions": merged,
        "fee_types": fees,
        "pay_trans": pay_trans,
    }


def build_dashboard_payload(data_dir: Path | None = None) -> dict[str, Any]:
    data = load_payment_data(data_dir)
    receipts = data["receipts"]
    trans = data["transactions"]
    fees = data["fee_types"]

    years = sorted(
        set(receipts["BUDGET_YEAR"].dropna().astype(int))
        | set(trans["BUDGET_YEAR"].dropna().astype(int))
    )
    rates_df = resolve_rates(
        years,
        {"exchange_rates": {"bdl_official": RATES_BDL, "overrides": {}, "source_priority": ["bdl_official"]}},
    )

    # Yearly summary
    rec_yr = (
        receipts.groupby("BUDGET_YEAR", as_index=False)
        .agg(
            payments_count=("RECEIPT_ID", "count"),
            payments_lbp=("total_lbp", "sum"),
        )
        .rename(columns={"BUDGET_YEAR": "year"})
    )
    rec_yr["year"] = rec_yr["year"].astype(int)

    credit = trans[trans["ACCOUNT_TYPE"] == "CREDIT"]
    recv_yr = (
        credit.groupby("BUDGET_YEAR", as_index=False)
        .agg(
            receivable_lines=("AMOUNT", "count"),
            receivables_lbp=("AMOUNT", "sum"),
        )
        .rename(columns={"BUDGET_YEAR": "year"})
    )
    recv_yr["year"] = recv_yr["year"].astype(int)

    yearly = rec_yr.merge(recv_yr, on="year", how="outer").fillna(0)
    yearly = yearly.merge(rates_df[["year", "lbp_per_usd"]], on="year", how="left")
    yearly["payments_usd"] = yearly["payments_lbp"] / yearly["lbp_per_usd"]
    yearly["receivables_usd"] = yearly["receivables_lbp"] / yearly["lbp_per_usd"]
    yearly["gap_lbp"] = yearly["receivables_lbp"] - yearly["payments_lbp"]
    yearly["gap_usd"] = yearly["gap_lbp"] / yearly["lbp_per_usd"]
    yearly["collection_rate"] = (
        (yearly["payments_lbp"] / yearly["receivables_lbp"].replace(0, pd.NA)) * 100
    ).round(2)

    # Category breakdown (CREDIT = receivables by fee type)
    cat = (
        credit.groupby(["BUDGET_YEAR", "FEE_TYPE_ID"], as_index=False)
        .agg(amount_lbp=("AMOUNT", "sum"), line_count=("AMOUNT", "count"))
        .rename(columns={"BUDGET_YEAR": "year"})
    )
    cat["year"] = cat["year"].astype(int)
    cat = cat.merge(
        fees[
            [
                "FEE_TYPE_ID",
                "FEE_TYPE_NAME",
                "FEE_TYPE_SHORTNAME",
                "FEETP",
                "YEARLY",
                "TREASURY_FEE_FLAG",
            ]
        ],
        on="FEE_TYPE_ID",
        how="left",
    )
    cat = cat.merge(rates_df[["year", "lbp_per_usd"]], on="year", how="left")
    cat["amount_usd"] = cat["amount_lbp"] / cat["lbp_per_usd"]
    cat["category_group"] = cat["FEETP"].map(FEETP_LABELS).fillna("Other")

    # Payments allocated to categories (DEBIT total split across CREDIT fee lines)
    debit = trans[trans["ACCOUNT_TYPE"] == "DEBIT"].groupby("PAY_TRANS_ID", as_index=False).agg(
        paid_lbp=("AMOUNT", "sum")
    )
    credit_lines = credit[credit["FEE_TYPE_ID"].notna()].copy()
    credit_lines = credit_lines.merge(debit, on="PAY_TRANS_ID", how="inner")
    txn_credit = credit_lines.groupby("PAY_TRANS_ID", as_index=False).agg(
        credit_total=("AMOUNT", "sum")
    )
    credit_lines = credit_lines.merge(txn_credit, on="PAY_TRANS_ID", how="left")
    credit_lines["paid_share"] = (
        credit_lines["AMOUNT"] / credit_lines["credit_total"].replace(0, pd.NA)
    ) * credit_lines["paid_lbp"]
    pay_cat = (
        credit_lines.groupby(["BUDGET_YEAR", "FEE_TYPE_ID"], as_index=False)
        .agg(amount_lbp=("paid_share", "sum"), line_count=("paid_share", "count"))
        .rename(columns={"BUDGET_YEAR": "year"})
    )
    pay_cat["year"] = pay_cat["year"].astype(int)
    pay_cat = pay_cat.merge(
        fees[
            [
                "FEE_TYPE_ID",
                "FEE_TYPE_NAME",
                "FEE_TYPE_SHORTNAME",
                "FEETP",
                "YEARLY",
                "TREASURY_FEE_FLAG",
            ]
        ],
        on="FEE_TYPE_ID",
        how="left",
    )
    pay_cat = pay_cat.merge(rates_df[["year", "lbp_per_usd"]], on="year", how="left")
    pay_cat["amount_usd"] = pay_cat["amount_lbp"] / pay_cat["lbp_per_usd"]
    pay_cat["category_group"] = pay_cat["FEETP"].map(FEETP_LABELS).fillna("Other")

    # Monthly payment flow
    receipts_m = receipts.dropna(subset=["RECEIPT_DATE"]).copy()
    receipts_m["month"] = receipts_m["RECEIPT_DATE"].dt.to_period("M").astype(str)
    monthly = (
        receipts_m.groupby(["BUDGET_YEAR", "month"], as_index=False)
        .agg(payments_lbp=("total_lbp", "sum"), count=("RECEIPT_ID", "count"))
        .rename(columns={"BUDGET_YEAR": "year"})
    )
    monthly["year"] = monthly["year"].astype(int)
    monthly = monthly.merge(rates_df[["year", "lbp_per_usd"]], on="year", how="left")
    monthly["payments_usd"] = monthly["payments_lbp"] / monthly["lbp_per_usd"]

    # Category map nodes (all-time + per year totals for treemap)
    cat_totals = (
        cat.groupby(
            ["FEE_TYPE_ID", "FEE_TYPE_NAME", "FEE_TYPE_SHORTNAME", "category_group"],
            as_index=False,
        )
        .agg(total_lbp=("amount_lbp", "sum"), total_usd=("amount_usd", "sum"))
        .sort_values("total_usd", ascending=False)
    )

    group_totals = (
        cat.groupby("category_group", as_index=False)
        .agg(total_usd=("amount_usd", "sum"))
        .sort_values("total_usd", ascending=False)
    )

    payment_ledger = _build_payment_ledger(receipts, trans, data["pay_trans"], fees, rates_df)
    receivable_ledger = _build_receivable_ledger(trans, data["pay_trans"], fees, rates_df)

    date_min = receipts["RECEIPT_DATE"].min()
    date_max = receipts["RECEIPT_DATE"].max()

    return {
        "meta": {
            "municipality": "Al-Kahaleh (Site 165)",
            "receipt_count": int(len(receipts)),
            "transaction_lines": int(len(trans)),
            "fee_categories": int(len(fees)),
            "years": years,
            "date_min": date_min.strftime("%Y-%m-%d") if pd.notna(date_min) else None,
            "date_max": date_max.strftime("%Y-%m-%d") if pd.notna(date_max) else None,
        },
        "exchange_rates": rates_df.to_dict(orient="records"),
        "yearly_summary": yearly.round(2).to_dict(orient="records"),
        "categories_by_year": cat.round(2).to_dict(orient="records"),
        "payments_by_year": pay_cat.round(2).to_dict(orient="records"),
        "category_totals": cat_totals.round(2).to_dict(orient="records"),
        "category_groups": group_totals.round(2).to_dict(orient="records"),
        "monthly_payments": monthly.round(2).to_dict(orient="records"),
        "fee_types": fees.fillna("").to_dict(orient="records"),
        "payment_ledger": payment_ledger,
        "receivable_ledger": receivable_ledger,
    }


def _build_payment_ledger(
    receipts: pd.DataFrame,
    trans: pd.DataFrame,
    pay_trans: pd.DataFrame,
    fees: pd.DataFrame,
    rates_df: pd.DataFrame,
) -> list[dict[str, Any]]:
    """One record per receipt with linked ledger lines for dashboard drill-down."""
    pt_cols = [
        "PAY_TRANS_ID", "BUDGET_YEAR", "TRANSACTION_DATE", "MUKALLAF_NAME", "MUKALLAF_ID",
        "DOCUMENT_NUM1", "DOCUMENT_NUM2", "DOCUMENT_NUM3", "USER_ID",
    ]
    pt = pay_trans[[c for c in pt_cols if c in pay_trans.columns]].drop_duplicates("PAY_TRANS_ID")

    rec = receipts.copy()
    rec["date"] = rec["RECEIPT_DATE"].dt.strftime("%Y-%m-%d")
    rec["RECEIPT_NUMBER"] = pd.to_numeric(rec["RECEIPT_NUMBER"], errors="coerce")
    pt = pt.copy()
    pt["DOCUMENT_NUM1"] = pd.to_numeric(pt["DOCUMENT_NUM1"], errors="coerce")
    rec = rec.merge(
        pt,
        left_on="RECEIPT_NUMBER",
        right_on="DOCUMENT_NUM1",
        how="left",
        suffixes=("", "_pt"),
    )

    fee_lu = fees.set_index("FEE_TYPE_ID")
    rate_lu = rates_df.set_index("year")["lbp_per_usd"]

    lines_by_pt: dict[int, list[dict[str, Any]]] = {}
    for _, row in trans.iterrows():
        pid = int(row["PAY_TRANS_ID"]) if pd.notna(row["PAY_TRANS_ID"]) else None
        if pid is None:
            continue
        fid = row.get("FEE_TYPE_ID")
        fee_name = ""
        fee_short = ""
        group = "Other"
        if pd.notna(fid) and int(fid) in fee_lu.index:
            f = fee_lu.loc[int(fid)]
            fee_name = str(f.get("FEE_TYPE_NAME") or "")
            fee_short = str(f.get("FEE_TYPE_SHORTNAME") or "")
            group = FEETP_LABELS.get(int(f.get("FEETP", 3)), "Other")
        yr = int(row["BUDGET_YEAR"]) if pd.notna(row.get("BUDGET_YEAR")) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        amt = float(row["AMOUNT"] or 0)
        lines_by_pt.setdefault(pid, []).append({
            "seq": int(row["TRANSACTION_SEQ"]) if pd.notna(row.get("TRANSACTION_SEQ")) else None,
            "account_type": str(row["ACCOUNT_TYPE"]),
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "fee_type_id": int(fid) if pd.notna(fid) else None,
            "fee_name": fee_name,
            "fee_short": fee_short,
            "category_group": group,
            "description": str(row.get("TRANSACTION_DESC") or "")[:120],
        })

    ledger: list[dict[str, Any]] = []
    for _, r in rec.iterrows():
        if pd.isna(r.get("RECEIPT_ID")):
            continue
        yr = int(r["BUDGET_YEAR"]) if pd.notna(r["BUDGET_YEAR"]) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        amt = float(r["total_lbp"])
        fine = float(r.get("RECEIPT_FINE_AMOUNT") or 0)
        pid = int(r["PAY_TRANS_ID"]) if pd.notna(r.get("PAY_TRANS_ID")) else None
        lines = lines_by_pt.get(pid, []) if pid else []
        credits = [l for l in lines if l["account_type"] == "CREDIT"]
        groups = sorted({l["category_group"] for l in credits if l["category_group"]})
        top_cat = ""
        if credits:
            top = max(credits, key=lambda x: x["amount_lbp"])
            top_cat = top.get("fee_short") or top.get("fee_name") or ""

        ledger.append({
            "receipt_id": int(r["RECEIPT_ID"]),
            "receipt_number": int(r["RECEIPT_NUMBER"]) if pd.notna(r["RECEIPT_NUMBER"]) else None,
            "date": r["date"] if pd.notna(r.get("date")) else None,
            "budget_year": yr,
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "fine_lbp": round(fine, 2),
            "taxpayer": str(r.get("MUKALLAF_NAME") or "").strip(),
            "mukallaf_id": int(r["MUKALLAF_ID"]) if pd.notna(r.get("MUKALLAF_ID")) else None,
            "pay_trans_id": pid,
            "collector": str(r.get("PAY_COLLECTOR") or ""),
            "user_id": str(r.get("USERID") or r.get("USER_ID") or ""),
            "remarks": str(r.get("RECEIPT_REMARKS") or "").strip() or None,
            "category_groups": groups,
            "primary_category": top_cat,
            "line_count": len(lines),
            "lines": lines,
        })

    ledger.sort(key=lambda x: (x["date"] or "", x["receipt_id"]), reverse=True)
    return ledger


def _build_receivable_ledger(
    trans: pd.DataFrame,
    pay_trans: pd.DataFrame,
    fees: pd.DataFrame,
    rates_df: pd.DataFrame,
) -> list[dict[str, Any]]:
    """One record per pay transaction with CREDIT (charge) lines for dashboard drill-down."""
    pt_cols = [
        "PAY_TRANS_ID", "BUDGET_YEAR", "TRANSACTION_DATE", "MUKALLAF_NAME", "MUKALLAF_ID",
        "DOCUMENT_NUM1", "DOCUMENT_NUM2", "DOCUMENT_NUM3", "USER_ID",
    ]
    pt = pay_trans[[c for c in pt_cols if c in pay_trans.columns]].drop_duplicates("PAY_TRANS_ID")
    pt = pt.copy()
    pt["TRANSACTION_DATE"] = pd.to_datetime(pt["TRANSACTION_DATE"], errors="coerce")

    fee_lu = fees.set_index("FEE_TYPE_ID")
    rate_lu = rates_df.set_index("year")["lbp_per_usd"]

    credit = trans[trans["ACCOUNT_TYPE"] == "CREDIT"]
    lines_by_pt: dict[int, list[dict[str, Any]]] = {}
    for _, row in credit.iterrows():
        pid = int(row["PAY_TRANS_ID"]) if pd.notna(row["PAY_TRANS_ID"]) else None
        if pid is None:
            continue
        fid = row.get("FEE_TYPE_ID")
        fee_name = ""
        fee_short = ""
        group = "Other"
        if pd.notna(fid) and int(fid) in fee_lu.index:
            f = fee_lu.loc[int(fid)]
            fee_name = str(f.get("FEE_TYPE_NAME") or "")
            fee_short = str(f.get("FEE_TYPE_SHORTNAME") or "")
            group = FEETP_LABELS.get(int(f.get("FEETP", 3)), "Other")
        yr = int(row["BUDGET_YEAR"]) if pd.notna(row.get("BUDGET_YEAR")) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        amt = float(row["AMOUNT"] or 0)
        lines_by_pt.setdefault(pid, []).append({
            "seq": int(row["TRANSACTION_SEQ"]) if pd.notna(row.get("TRANSACTION_SEQ")) else None,
            "account_type": "CREDIT",
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "fee_type_id": int(fid) if pd.notna(fid) else None,
            "fee_name": fee_name,
            "fee_short": fee_short,
            "category_group": group,
            "description": str(row.get("TRANSACTION_DESC") or "")[:120],
        })

    pt_lu = pt.set_index("PAY_TRANS_ID")
    ledger: list[dict[str, Any]] = []
    for pid, lines in lines_by_pt.items():
        if pid not in pt_lu.index:
            continue
        r = pt_lu.loc[pid]
        if isinstance(r, pd.DataFrame):
            r = r.iloc[0]
        yr = int(r["BUDGET_YEAR"]) if pd.notna(r.get("BUDGET_YEAR")) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        total_lbp = sum(l["amount_lbp"] for l in lines)
        groups = sorted({l["category_group"] for l in lines if l["category_group"]})
        top_cat = ""
        if lines:
            top = max(lines, key=lambda x: x["amount_lbp"])
            top_cat = top.get("fee_short") or top.get("fee_name") or ""
        tx_date = r.get("TRANSACTION_DATE")
        date_str = tx_date.strftime("%Y-%m-%d") if pd.notna(tx_date) else None

        ledger.append({
            "pay_trans_id": pid,
            "date": date_str,
            "budget_year": yr,
            "amount_lbp": round(total_lbp, 2),
            "amount_usd": round(total_lbp / rate, 2),
            "taxpayer": str(r.get("MUKALLAF_NAME") or "").strip(),
            "mukallaf_id": int(r["MUKALLAF_ID"]) if pd.notna(r.get("MUKALLAF_ID")) else None,
            "document_num": int(r["DOCUMENT_NUM1"]) if pd.notna(r.get("DOCUMENT_NUM1")) else None,
            "user_id": str(r.get("USER_ID") or ""),
            "category_groups": groups,
            "primary_category": top_cat,
            "line_count": len(lines),
            "lines": lines,
        })

    ledger.sort(key=lambda x: (x["date"] or "", x["pay_trans_id"]), reverse=True)
    return ledger
