"""Municipal inbound (receivables) analytics from CSV exports.

Receivables (money in) = RECEIPTS + CREDIT fee allocation lines.
Municipal payments (money out) = MBS_PAYMENTS — see muni_outflows.py.
"""

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

# Official payment report splits rental-value fee via FEE_TYPE_DET:
# 1 = (س) سكني / residential, 2 = (غ) غير سكني / non-residential.
RENTAL_FEE_TYPE_ID = 1
RENTAL_DET_LABELS = {1: "س", 2: "غ"}


def _rental_det_key(fee_type_id: Any, fee_type_det: Any) -> int | None:
    """Return 1/2 for rental (س)/(غ); None = do not split."""
    try:
        if int(fee_type_id) != RENTAL_FEE_TYPE_ID:
            return None
        det = int(fee_type_det)
    except (TypeError, ValueError):
        return None
    return det if det in RENTAL_DET_LABELS else None


def _fee_display_name(base_name: str, fee_type_id: Any, fee_type_det: Any) -> str:
    label = RENTAL_DET_LABELS.get(_rental_det_key(fee_type_id, fee_type_det) or -1)
    if label:
        return f"{base_name}({label})"
    return base_name


def _category_key(fee_type_id: Any, fee_type_det: Any) -> str:
    det = _rental_det_key(fee_type_id, fee_type_det)
    fid = int(fee_type_id) if pd.notna(fee_type_id) else 0
    return f"{fid}:{det}" if det is not None else str(fid)


def _clean_str(val: Any) -> str:
    if val is None or (isinstance(val, float) and pd.isna(val)) or pd.isna(val):
        return ""
    text = str(val).strip()
    return "" if text.lower() in {"", "nan", "none", "null"} else text


def _annotate_fee_split(df: pd.DataFrame) -> pd.DataFrame:
    """Add DET_KEY / category_key columns for official (س)/(غ) rental split."""
    out = df.copy()
    if "FEE_TYPE_DET" not in out.columns:
        out["FEE_TYPE_DET"] = pd.NA
    out["FEE_TYPE_DET"] = pd.to_numeric(out["FEE_TYPE_DET"], errors="coerce")
    out["DET_KEY"] = [
        _rental_det_key(fid, det)
        for fid, det in zip(out["FEE_TYPE_ID"], out["FEE_TYPE_DET"], strict=False)
    ]
    # Non-split rows share one bucket (NaN) so they stay a single category.
    out["DET_KEY"] = out["DET_KEY"].astype("Int64")
    return out


def _load_fee_budget_map(data_dir: Path | None = None) -> dict[tuple[int, int], dict[str, Any]]:
    """Official FEE_TYPE → income budget chapter/section via FEE_TANSSIB_ACCOUNT.

    Prefers law-5595 codes (IS_5595=Y). Key: (FEE_TYPE_ID, FEE_TYPE_DET) with
    DET=0 for non-split fees and 1/2 for rental (سكن / غير سكن).
    """
    base = data_dir or DATA_DIR
    acct_path = base / "FEE_TANSSIB_ACCOUNT.csv"
    desc_path = base / "FEE_TANSSIB_ACCOUNT_DESC.csv"
    if not acct_path.exists():
        return {}

    acct = pd.read_csv(acct_path, low_memory=False)
    if acct.empty:
        return {}
    acct["FEE_TYPE_ID"] = pd.to_numeric(acct.get("FEE_TYPE_ID"), errors="coerce")
    acct["FEE_TYPE_DET"] = pd.to_numeric(acct.get("FEE_TYPE_DET"), errors="coerce").fillna(0)
    acct["FROM_YEAR"] = pd.to_numeric(acct.get("FROM_YEAR"), errors="coerce").fillna(0)
    acct["TILL_YEAR"] = pd.to_numeric(acct.get("TILL_YEAR"), errors="coerce")
    detail = acct.get("FEE_DETAIL", pd.Series(dtype=str)).astype(str).str.upper()
    is5595 = acct.get("IS_5595", pd.Series(dtype=str)).astype(str).str.upper()
    acct = acct[(detail == "FEE") & (is5595 == "Y") & acct["FEE_TYPE_ID"].notna()].copy()
    acct["TANSSIB"] = acct.get("TANSSIB").map(_clean_str)
    acct = acct[acct["TANSSIB"] != ""]
    if acct.empty:
        return {}

    # Latest applicable mapping per fee + det.
    acct = acct.sort_values(["FEE_TYPE_ID", "FEE_TYPE_DET", "FROM_YEAR"], ascending=[True, True, False])
    acct = acct.drop_duplicates(["FEE_TYPE_ID", "FEE_TYPE_DET"], keep="first")

    desc_lu: dict[str, dict[str, Any]] = {}
    if desc_path.exists():
        desc = pd.read_csv(desc_path, low_memory=False)
        if not desc.empty:
            desc["TANSSIB_CODE"] = desc.get("TANSSIB_CODE").map(_clean_str)
            desc["CHAPTER_CODE"] = pd.to_numeric(desc.get("CHAPTER_CODE"), errors="coerce")
            desc["SECTION_CODE"] = pd.to_numeric(desc.get("SECTION_CODE"), errors="coerce")
            for _, r in desc.drop_duplicates("TANSSIB_CODE").iterrows():
                code = r.get("TANSSIB_CODE")
                if not code:
                    continue
                desc_lu[code] = {
                    "chapter": int(r["CHAPTER_CODE"]) if pd.notna(r.get("CHAPTER_CODE")) else None,
                    "section": int(r["SECTION_CODE"]) if pd.notna(r.get("SECTION_CODE")) else None,
                    "chapter_desc": _clean_str(r.get("CHAPTER_DESC")),
                    "section_desc": _clean_str(r.get("SECTION_DESC")),
                }

    out: dict[tuple[int, int], dict[str, Any]] = {}
    for _, r in acct.iterrows():
        fid = int(r["FEE_TYPE_ID"])
        det = int(r["FEE_TYPE_DET"])
        code = r["TANSSIB"]
        meta = desc_lu.get(code, {})
        chapter = meta.get("chapter")
        section = meta.get("section")
        if chapter is None or section is None:
            parts = code.split("-")
            if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                chapter = int(parts[0])
                section = int(parts[1])
        chapter_desc = meta.get("chapter_desc") or ""
        section_desc = meta.get("section_desc") or ""
        # Fallback labels from MBS income taxonomy when DESC row missing.
        if (not chapter_desc or not section_desc) and chapter is not None and section is not None:
            pass  # filled below via sections CSV if needed
        out[(fid, det)] = {
            "budget_code": code,
            "chapter": chapter,
            "section": section,
            "chapter_desc": chapter_desc,
            "section_desc": section_desc,
        }

    # Fill missing Arabic labels from exported MBS_CHAPTERS / MBS_SECTIONS (income).
    chapters = base / "MBS_CHAPTERS.csv"
    sections = base / "MBS_SECTIONS.csv"
    ch_lu: dict[int, str] = {}
    sec_lu: dict[tuple[int, int], str] = {}
    if chapters.exists():
        ch = pd.read_csv(chapters, low_memory=False)
        ch = ch[ch.get("CHAPTER_TYPE", pd.Series(dtype=str)).astype(str).str.upper() == "I"]
        ch["CHAPTER"] = pd.to_numeric(ch.get("CHAPTER"), errors="coerce")
        ch["BUDGET_YEAR"] = pd.to_numeric(ch.get("BUDGET_YEAR"), errors="coerce")
        ch = ch.sort_values("BUDGET_YEAR", ascending=False).drop_duplicates("CHAPTER")
        for _, r in ch.iterrows():
            if pd.notna(r.get("CHAPTER")):
                ch_lu[int(r["CHAPTER"])] = _clean_str(r.get("DESCRIPT"))
    if sections.exists():
        sec = pd.read_csv(sections, low_memory=False)
        sec = sec[sec.get("CHAPTER_TYPE", pd.Series(dtype=str)).astype(str).str.upper() == "I"]
        sec["CHAPTER"] = pd.to_numeric(sec.get("CHAPTER"), errors="coerce")
        sec["SECTION"] = pd.to_numeric(sec.get("SECTION"), errors="coerce")
        sec["BUDGET_YEAR"] = pd.to_numeric(sec.get("BUDGET_YEAR"), errors="coerce")
        sec = sec.sort_values("BUDGET_YEAR", ascending=False).drop_duplicates(["CHAPTER", "SECTION"])
        for _, r in sec.iterrows():
            if pd.notna(r.get("CHAPTER")) and pd.notna(r.get("SECTION")):
                sec_lu[(int(r["CHAPTER"]), int(r["SECTION"]))] = _clean_str(r.get("DESCRIPT"))

    for key, meta in out.items():
        ch = meta.get("chapter")
        sec = meta.get("section")
        if not meta.get("chapter_desc") and ch in ch_lu:
            meta["chapter_desc"] = ch_lu[ch]
        if not meta.get("section_desc") and ch is not None and sec is not None:
            meta["section_desc"] = sec_lu.get((ch, sec), "")

    # Fees with ACCOUNT but no TANSSIB code in FEE_TANSSIB_ACCOUNT — map by official name.
    # 31 → income 2.2 (حصة … الإسكان). 30 (رسم التعمير) has no dedicated income section;
    # keep near construction licensing (1.11) used for related building fees.
    _NAME_FALLBACKS: dict[int, tuple[str, int, int]] = {
        31: ("02-02", 2, 2),
        30: ("01-11", 1, 11),
    }
    for fid, (code, ch, sec) in _NAME_FALLBACKS.items():
        if (fid, 0) in out and out[(fid, 0)].get("section_desc"):
            continue
        out[(fid, 0)] = {
            "budget_code": code,
            "chapter": ch,
            "section": sec,
            "chapter_desc": ch_lu.get(ch, ""),
            "section_desc": sec_lu.get((ch, sec), ""),
        }
    return out


def _lookup_fee_budget(
    budget_map: dict[tuple[int, int], dict[str, Any]],
    fee_type_id: Any,
    fee_type_det: Any,
) -> dict[str, Any] | None:
    if not budget_map or pd.isna(fee_type_id):
        return None
    try:
        fid = int(fee_type_id)
    except (TypeError, ValueError):
        return None
    det = _rental_det_key(fid, fee_type_det)
    if det is not None and (fid, det) in budget_map:
        return budget_map[(fid, det)]
    if (fid, 0) in budget_map:
        return budget_map[(fid, 0)]
    return None


def _fee_category_fields(
    fee_row: Any,
    fee_type_id: Any,
    fee_type_det: Any,
    budget_map: dict[tuple[int, int], dict[str, Any]],
) -> dict[str, Any]:
    """Resolve display names + official income budget category for a fee line."""
    base_name = str(fee_row.get("FEE_TYPE_NAME") or "") if fee_row is not None else ""
    base_short = str(fee_row.get("FEE_TYPE_SHORTNAME") or "") if fee_row is not None else ""
    feetp = int(fee_row.get("FEETP", 3)) if fee_row is not None and pd.notna(fee_row.get("FEETP")) else 3
    fallback_group = FEETP_LABELS.get(feetp, "Other")
    fee_name = _fee_display_name(base_name, fee_type_id, fee_type_det)
    fee_short = (
        _fee_display_name(base_short, fee_type_id, fee_type_det)
        if _rental_det_key(fee_type_id, fee_type_det)
        else base_short
    )
    bud = _lookup_fee_budget(budget_map, fee_type_id, fee_type_det)
    if bud and (bud.get("section_desc") or bud.get("chapter_desc")):
        section_desc = bud.get("section_desc") or fee_name
        return {
            "fee_name": section_desc,
            "fee_short": section_desc,
            "category_group": bud.get("chapter_desc") or fallback_group,
            "budget_code": bud.get("budget_code"),
            "chapter": bud.get("chapter"),
            "section": bud.get("section"),
            "chapter_desc": bud.get("chapter_desc") or "",
            "section_desc": section_desc,
        }
    return {
        "fee_name": fee_name,
        "fee_short": fee_short or fee_name,
        "category_group": fallback_group,
        "budget_code": None,
        "chapter": None,
        "section": None,
        "chapter_desc": "",
        "section_desc": "",
    }


def _apply_budget_categories_df(
    df: pd.DataFrame,
    budget_map: dict[tuple[int, int], dict[str, Any]],
) -> pd.DataFrame:
    """Overwrite category_group / fee names with official income budget labels."""
    out = df.copy()
    groups: list[str] = []
    names: list[str] = []
    shorts: list[str] = []
    codes: list[str | None] = []
    for fid, det, name, short, feetp in zip(
        out["FEE_TYPE_ID"],
        out["FEE_TYPE_DET"],
        out.get("FEE_TYPE_NAME", pd.Series([""] * len(out))),
        out.get("FEE_TYPE_SHORTNAME", pd.Series([""] * len(out))),
        out.get("FEETP", pd.Series([3] * len(out))),
        strict=False,
    ):
        fee_row = {"FEE_TYPE_NAME": name, "FEE_TYPE_SHORTNAME": short, "FEETP": feetp}
        fields = _fee_category_fields(fee_row, fid, det, budget_map)
        groups.append(fields["category_group"])
        names.append(fields["fee_name"])
        shorts.append(fields["fee_short"])
        codes.append(fields.get("budget_code"))
    out["category_group"] = groups
    out["FEE_TYPE_NAME"] = names
    out["FEE_TYPE_SHORTNAME"] = shorts
    out["budget_code"] = codes
    return out

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
    receipts["RECEIPT_NUMBER"] = pd.to_numeric(
        receipts.get("RECEIPT_NUMBER"), errors="coerce"
    )
    receipts["total_lbp"] = receipts["RECEIPT_AMOUNT"] + receipts["RECEIPT_FINE_AMOUNT"]
    receipts["RECEIPT_DATE"] = pd.to_datetime(receipts["RECEIPT_DATE"], errors="coerce")
    # Drop void placeholder rows (no receipt #, zero amount) — show as 0 / nan in UI.
    receipts = receipts[
        ~((receipts["total_lbp"] <= 0) & (receipts["RECEIPT_NUMBER"].fillna(0) <= 0))
    ].copy()

    trans = pd.read_csv(base / "MRS_PAY_TRANSACTIONS.csv")
    trans["PAY_TRANS_ID"] = pd.to_numeric(trans["PAY_TRANS_ID"], errors="coerce")
    trans["AMOUNT"] = pd.to_numeric(trans["AMOUNT"], errors="coerce").fillna(0)
    trans["FEE_TYPE_ID"] = pd.to_numeric(trans["FEE_TYPE_ID"], errors="coerce")
    trans["FEE_TYPE_DET"] = pd.to_numeric(trans.get("FEE_TYPE_DET"), errors="coerce")

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
    budget_map = _load_fee_budget_map(data_dir)

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
    # CREDIT totals = fee allocation of payment journals (not assessments / AR).
    fee_yr = (
        credit.groupby("BUDGET_YEAR", as_index=False)
        .agg(
            fee_alloc_lines=("AMOUNT", "count"),
            fee_allocated_lbp=("AMOUNT", "sum"),
        )
        .rename(columns={"BUDGET_YEAR": "year"})
    )
    fee_yr["year"] = fee_yr["year"].astype(int)

    yearly = rec_yr.merge(fee_yr, on="year", how="outer").fillna(0)
    yearly = yearly.merge(rates_df[["year", "lbp_per_usd"]], on="year", how="left")
    yearly["payments_usd"] = yearly["payments_lbp"] / yearly["lbp_per_usd"]
    yearly["fee_allocated_usd"] = yearly["fee_allocated_lbp"] / yearly["lbp_per_usd"]
    # Legacy keys kept for dashboard field compatibility (same values as fee_allocated_*).
    yearly["receivable_lines"] = yearly["fee_alloc_lines"]
    yearly["receivables_lbp"] = yearly["fee_allocated_lbp"]
    yearly["receivables_usd"] = yearly["fee_allocated_usd"]
    # No true AR without TAKLEEFAT — do not invent collection rate / outstanding gap.
    yearly["gap_lbp"] = None
    yearly["gap_usd"] = None
    yearly["collection_rate"] = None
    yearly["allocation_coverage"] = (
        (yearly["fee_allocated_lbp"] / yearly["payments_lbp"].replace(0, pd.NA)) * 100
    ).round(2)

    # Category breakdown (CREDIT = fee allocation by fee type), with rental (س)/(غ) split
    credit = _annotate_fee_split(credit)
    cat = (
        credit.groupby(["BUDGET_YEAR", "FEE_TYPE_ID", "DET_KEY"], as_index=False, dropna=False)
        .agg(amount_lbp=("AMOUNT", "sum"), line_count=("AMOUNT", "count"))
        .rename(columns={"BUDGET_YEAR": "year", "DET_KEY": "FEE_TYPE_DET"})
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
    cat["FEE_TYPE_SHORTNAME"] = cat["FEE_TYPE_SHORTNAME"].fillna("")
    cat = _apply_budget_categories_df(cat, budget_map)
    cat["category_key"] = [
        _category_key(fid, det)
        for fid, det in zip(cat["FEE_TYPE_ID"], cat["FEE_TYPE_DET"], strict=False)
    ]

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
        credit_lines.groupby(["BUDGET_YEAR", "FEE_TYPE_ID", "DET_KEY"], as_index=False, dropna=False)
        .agg(amount_lbp=("paid_share", "sum"), line_count=("paid_share", "count"))
        .rename(columns={"BUDGET_YEAR": "year", "DET_KEY": "FEE_TYPE_DET"})
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
    pay_cat["FEE_TYPE_SHORTNAME"] = pay_cat["FEE_TYPE_SHORTNAME"].fillna("")
    pay_cat = _apply_budget_categories_df(pay_cat, budget_map)
    pay_cat["category_key"] = [
        _category_key(fid, det)
        for fid, det in zip(pay_cat["FEE_TYPE_ID"], pay_cat["FEE_TYPE_DET"], strict=False)
    ]

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
            [
                "category_key",
                "FEE_TYPE_ID",
                "FEE_TYPE_DET",
                "FEE_TYPE_NAME",
                "FEE_TYPE_SHORTNAME",
                "category_group",
            ],
            as_index=False,
            dropna=False,
        )
        .agg(total_lbp=("amount_lbp", "sum"), total_usd=("amount_usd", "sum"))
        .sort_values("total_usd", ascending=False)
    )

    group_totals = (
        cat.groupby("category_group", as_index=False)
        .agg(total_usd=("amount_usd", "sum"))
        .sort_values("total_usd", ascending=False)
    )

    # Receipt ledger = money received (UI: Receivables). File: payments.json (legacy path).
    receipt_ledger = _build_payment_ledger(
        receipts, trans, data["pay_trans"], fees, rates_df, budget_map
    )
    fee_allocation_ledger = _build_fee_allocation_ledger(
        trans, data["pay_trans"], fees, rates_df, budget_map
    )
    unlinked_receipts = sum(1 for p in receipt_ledger if p.get("pay_trans_id") is None)

    from .muni_outflows import build_muni_payment_ledger, muni_payments_yearly_summary

    muni_payment_ledger = build_muni_payment_ledger(data_dir)
    muni_yearly = muni_payments_yearly_summary(muni_payment_ledger, rates_df)
    muni_by_year = {r["year"]: r for r in muni_yearly}
    years = sorted(set(years) | {int(r["year"]) for r in muni_yearly})

    date_min = receipts["RECEIPT_DATE"].min()
    date_max = receipts["RECEIPT_DATE"].max()
    if muni_payment_ledger:
        muni_dates = [p["date"] for p in muni_payment_ledger if p.get("date")]
        if muni_dates:
            muni_min = min(muni_dates)
            muni_max = max(muni_dates)
            if not date_min or muni_min < str(date_min)[:10]:
                date_min = pd.Timestamp(muni_min)
            if not date_max or muni_max > str(date_max)[:10]:
                date_max = pd.Timestamp(muni_max)

    # round() would turn None into NaN; round numeric columns only.
    yearly_out = yearly.copy()
    yearly_out["paid_out_lbp"] = yearly_out["year"].map(
        lambda y: muni_by_year.get(int(y), {}).get("paid_out_lbp", 0)
    )
    yearly_out["paid_out_usd"] = yearly_out["year"].map(
        lambda y: muni_by_year.get(int(y), {}).get("paid_out_usd", 0)
    )
    yearly_out["paid_out_count"] = yearly_out["year"].map(
        lambda y: muni_by_year.get(int(y), {}).get("paid_out_count", 0)
    )
    # Years that only appear in outflows
    for row in muni_yearly:
        if int(row["year"]) not in set(yearly_out["year"].astype(int)):
            yearly_out = pd.concat(
                [
                    yearly_out,
                    pd.DataFrame([{
                        "year": row["year"],
                        "payments_count": 0,
                        "payments_lbp": 0,
                        "fee_alloc_lines": 0,
                        "fee_allocated_lbp": 0,
                        "lbp_per_usd": rates_df.set_index("year")["lbp_per_usd"].get(row["year"], 1507.5),
                        "payments_usd": 0,
                        "fee_allocated_usd": 0,
                        "receivable_lines": 0,
                        "receivables_lbp": 0,
                        "receivables_usd": 0,
                        "gap_lbp": None,
                        "gap_usd": None,
                        "collection_rate": None,
                        "allocation_coverage": None,
                        "paid_out_lbp": row["paid_out_lbp"],
                        "paid_out_usd": row["paid_out_usd"],
                        "paid_out_count": row["paid_out_count"],
                    }]),
                ],
                ignore_index=True,
            )

    num_cols = [
        c for c in yearly_out.columns
        if c not in {"gap_lbp", "gap_usd", "collection_rate", "allocation_coverage"}
        and pd.api.types.is_numeric_dtype(yearly_out[c])
    ]
    yearly_out[num_cols] = yearly_out[num_cols].round(2)

    return {
        "meta": {
            "municipality": "Al-Kahaleh (Site 165)",
            "receipt_count": int(len(receipts)),
            "transaction_lines": int(len(trans)),
            "fee_categories": int(len(fees)),
            "muni_payment_count": int(len(muni_payment_ledger)),
            "muni_payments_available": bool(muni_payment_ledger),
            "years": years,
            "date_min": (
                date_min.strftime("%Y-%m-%d")
                if hasattr(date_min, "strftime") and pd.notna(date_min)
                else (str(date_min)[:10] if date_min else None)
            ),
            "date_max": (
                date_max.strftime("%Y-%m-%d")
                if hasattr(date_max, "strftime") and pd.notna(date_max)
                else (str(date_max)[:10] if date_max else None)
            ),
            "unlinked_receipts": unlinked_receipts,
            "semantics": {
                "receivables": "RECEIPTS cash received by the municipality (+ fee CREDIT split)",
                "fee_allocation": "MRS_PAY_TRANSACTIONS CREDIT lines (how receipts split by fee)",
                "payments": "MBS_PAYMENTS money paid out by the municipality",
                "assessments": "TAKLEEFAT not in export",
            },
        },
        "exchange_rates": rates_df.to_dict(orient="records"),
        "yearly_summary": yearly_out.sort_values("year").to_dict(orient="records"),
        "categories_by_year": cat.round(2).to_dict(orient="records"),
        "payments_by_year": pay_cat.round(2).to_dict(orient="records"),
        "category_totals": cat_totals.round(2).to_dict(orient="records"),
        "category_groups": group_totals.round(2).to_dict(orient="records"),
        "monthly_payments": monthly.round(2).to_dict(orient="records"),
        "fee_types": fees.fillna("").to_dict(orient="records"),
        # Legacy key: receipt/collections ledger → dashboard/data/payments.json
        "payment_ledger": receipt_ledger,
        "receivable_ledger": fee_allocation_ledger,
        "muni_payment_ledger": muni_payment_ledger,
    }


def _build_payment_ledger(
    receipts: pd.DataFrame,
    trans: pd.DataFrame,
    pay_trans: pd.DataFrame,
    fees: pd.DataFrame,
    rates_df: pd.DataFrame,
    budget_map: dict[tuple[int, int], dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """One record per receipt with linked ledger lines for dashboard drill-down."""
    budget_map = budget_map or {}
    pt_cols = [
        "PAY_TRANS_ID", "BUDGET_YEAR", "TRANSACTION_DATE", "MUKALLAF_NAME", "MUKALLAF_ID",
        "DOCUMENT_NUM1", "DOCUMENT_NUM2", "DOCUMENT_NUM3", "USER_ID",
    ]
    pt = pay_trans[[c for c in pt_cols if c in pay_trans.columns]].drop_duplicates("PAY_TRANS_ID")

    rec = receipts.copy()
    rec["date"] = rec["RECEIPT_DATE"].dt.strftime("%Y-%m-%d")
    rec["RECEIPT_NUMBER"] = pd.to_numeric(rec["RECEIPT_NUMBER"], errors="coerce")
    rec["RECEIPT_ID"] = pd.to_numeric(rec["RECEIPT_ID"], errors="coerce")
    pt = pt.copy()
    pt["DOCUMENT_NUM1"] = pd.to_numeric(pt["DOCUMENT_NUM1"], errors="coerce")
    # MRS_PAY_TRANS.DOCUMENT_NUM1 stores RECEIPT_ID (not RECEIPT_NUMBER).
    # DOCUMENT_NUM2 is typically the printed receipt number.
    rec = rec.merge(
        pt,
        left_on="RECEIPT_ID",
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
        fdet = row.get("FEE_TYPE_DET")
        fee_name = ""
        fee_short = ""
        group = "Other"
        budget_code = None
        if pd.notna(fid) and int(fid) in fee_lu.index:
            f = fee_lu.loc[int(fid)]
            fields = _fee_category_fields(f, fid, fdet, budget_map)
            fee_name = fields["fee_name"]
            fee_short = fields["fee_short"]
            group = fields["category_group"]
            budget_code = fields.get("budget_code")
        yr = int(row["BUDGET_YEAR"]) if pd.notna(row.get("BUDGET_YEAR")) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        amt = float(row["AMOUNT"] or 0)
        det_key = _rental_det_key(fid, fdet)
        lines_by_pt.setdefault(pid, []).append({
            "seq": int(row["TRANSACTION_SEQ"]) if pd.notna(row.get("TRANSACTION_SEQ")) else None,
            "account_type": str(row["ACCOUNT_TYPE"]),
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "fee_type_id": int(fid) if pd.notna(fid) else None,
            "fee_type_det": det_key,
            "category_key": _category_key(fid, fdet) if pd.notna(fid) else None,
            "fee_name": fee_name,
            "fee_short": fee_short,
            "category_group": group,
            "budget_code": budget_code,
            "description": str(row.get("TRANSACTION_DESC") or "")[:120],
        })

    ledger: list[dict[str, Any]] = []
    for _, r in rec.iterrows():
        if pd.isna(r.get("RECEIPT_ID")):
            continue
        amt = float(r["total_lbp"] or 0)
        receipt_num = int(r["RECEIPT_NUMBER"]) if pd.notna(r.get("RECEIPT_NUMBER")) else None
        # Skip void placeholders (amount 0 + no real receipt number).
        if amt <= 0 and (receipt_num is None or receipt_num <= 0):
            continue
        yr = int(r["BUDGET_YEAR"]) if pd.notna(r["BUDGET_YEAR"]) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        fine = float(r.get("RECEIPT_FINE_AMOUNT") or 0)
        pid = int(r["PAY_TRANS_ID"]) if pd.notna(r.get("PAY_TRANS_ID")) else None
        lines = lines_by_pt.get(pid, []) if pid is not None else []
        credits = [l for l in lines if l["account_type"] == "CREDIT"]
        groups = sorted({l["category_group"] for l in credits if l["category_group"]})
        top_cat = ""
        if credits:
            top = max(credits, key=lambda x: x["amount_lbp"])
            top_cat = top.get("fee_short") or top.get("fee_name") or ""

        ledger.append({
            "receipt_id": int(r["RECEIPT_ID"]),
            "receipt_number": receipt_num,
            "date": r["date"] if pd.notna(r.get("date")) else None,
            "budget_year": yr,
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "fine_lbp": round(fine, 2),
            "taxpayer": _clean_str(r.get("MUKALLAF_NAME")),
            "mukallaf_id": int(r["MUKALLAF_ID"]) if pd.notna(r.get("MUKALLAF_ID")) else None,
            "pay_trans_id": pid,
            "collector": _clean_str(r.get("PAY_COLLECTOR")),
            "user_id": _clean_str(r.get("USERID") if pd.notna(r.get("USERID")) else r.get("USER_ID")),
            "remarks": _clean_str(r.get("RECEIPT_REMARKS")) or None,
            "category_groups": groups,
            "primary_category": top_cat,
            "line_count": len(lines),
            "lines": lines,
        })

    ledger.sort(key=lambda x: (x["date"] or "", x["receipt_id"]), reverse=True)
    return ledger


def _build_fee_allocation_ledger(
    trans: pd.DataFrame,
    pay_trans: pd.DataFrame,
    fees: pd.DataFrame,
    rates_df: pd.DataFrame,
    budget_map: dict[tuple[int, int], dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """One record per pay transaction with CREDIT fee-allocation lines.

    These are not assessments/AR — they split cash receipts across fee types.
    """
    budget_map = budget_map or {}
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
        fdet = row.get("FEE_TYPE_DET")
        fee_name = ""
        fee_short = ""
        group = "Other"
        budget_code = None
        if pd.notna(fid) and int(fid) in fee_lu.index:
            f = fee_lu.loc[int(fid)]
            fields = _fee_category_fields(f, fid, fdet, budget_map)
            fee_name = fields["fee_name"]
            fee_short = fields["fee_short"]
            group = fields["category_group"]
            budget_code = fields.get("budget_code")
        yr = int(row["BUDGET_YEAR"]) if pd.notna(row.get("BUDGET_YEAR")) else None
        rate = float(rate_lu.get(yr, 1507.5)) if yr else 1507.5
        amt = float(row["AMOUNT"] or 0)
        det_key = _rental_det_key(fid, fdet)
        lines_by_pt.setdefault(pid, []).append({
            "seq": int(row["TRANSACTION_SEQ"]) if pd.notna(row.get("TRANSACTION_SEQ")) else None,
            "account_type": "CREDIT",
            "amount_lbp": round(amt, 2),
            "amount_usd": round(amt / rate, 2),
            "fee_type_id": int(fid) if pd.notna(fid) else None,
            "fee_type_det": det_key,
            "category_key": _category_key(fid, fdet) if pd.notna(fid) else None,
            "fee_name": fee_name,
            "fee_short": fee_short,
            "category_group": group,
            "budget_code": budget_code,
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
            "source": "payment_fee_allocation",
            "pay_trans_id": pid,
            "date": date_str,
            "budget_year": yr,
            "amount_lbp": round(total_lbp, 2),
            "amount_usd": round(total_lbp / rate, 2),
            "taxpayer": _clean_str(r.get("MUKALLAF_NAME")),
            "mukallaf_id": int(r["MUKALLAF_ID"]) if pd.notna(r.get("MUKALLAF_ID")) else None,
            "document_num": int(r["DOCUMENT_NUM1"]) if pd.notna(r.get("DOCUMENT_NUM1")) else None,
            "user_id": _clean_str(r.get("USER_ID")),
            "category_groups": groups,
            "primary_category": top_cat,
            "line_count": len(lines),
            "lines": lines,
        })

    ledger.sort(key=lambda x: (x["date"] or "", x["pay_trans_id"]), reverse=True)
    return ledger
