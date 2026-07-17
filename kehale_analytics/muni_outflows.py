"""Municipal outflow payments (money paid BY the municipality).

Source: MBS_PAYMENTS
  + MBS_ACCEPTANCES (beneficiary via ACCEPT_SEQ_YR)
  + MBS_RESERVES → MBS_CHAPTERS / MBS_SECTIONS / MBS_PARAGRAPH (official budget lines)
  + MBS_ACCEPT_DETAILS (invoice / purpose lines)
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

# Municipal outflows are expense budget lines (CHAPTER_TYPE = E).
EXPENSE_CHAPTER_TYPE = "E"


def _read_csv_optional(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, low_memory=False)


def _prep_accept_details(details: pd.DataFrame) -> pd.DataFrame:
    """Aggregate accept-detail lines per acceptance."""
    if details.empty:
        return pd.DataFrame()
    d = details.copy()
    d["BUDGET_YEAR"] = pd.to_numeric(d.get("BUDGET_YEAR"), errors="coerce")
    d["ACCEPT_SEQ_YR"] = pd.to_numeric(d.get("ACCEPT_SEQ_YR"), errors="coerce")
    d["ACC_DETAIL_SEQ"] = pd.to_numeric(d.get("ACC_DETAIL_SEQ"), errors="coerce")
    d["AMOUNT"] = pd.to_numeric(d.get("AMOUNT"), errors="coerce")
    d["DESCRIPTION"] = d.get("DESCRIPTION", "").map(_clean_str)
    d = d.dropna(subset=["BUDGET_YEAR", "ACCEPT_SEQ_YR"])
    d = d.sort_values(["BUDGET_YEAR", "ACCEPT_SEQ_YR", "ACC_DETAIL_SEQ"])

    rows: list[dict[str, Any]] = []
    for (yr, accept), g in d.groupby(["BUDGET_YEAR", "ACCEPT_SEQ_YR"], sort=False):
        lines = []
        for _, lr in g.iterrows():
            desc = lr.get("DESCRIPTION")
            if not desc:
                continue
            amt = lr.get("AMOUNT")
            lines.append({
                "seq": int(lr["ACC_DETAIL_SEQ"]) if pd.notna(lr.get("ACC_DETAIL_SEQ")) else None,
                "description": desc,
                "amount_lbp": round(float(amt), 2) if pd.notna(amt) else None,
            })
        purpose = " | ".join(x["description"] for x in lines) if lines else None
        rows.append({
            "BUDGET_YEAR": yr,
            "ACCEPT_SEQ_YR": accept,
            "PURPOSE_LINES": lines,
            "PURPOSE_DETAIL": purpose,
        })
    return pd.DataFrame(rows)


def _attach_budget_taxonomy(pay: pd.DataFrame, base: Path) -> pd.DataFrame:
    """Join reserves → official chapter/section/paragraph labels (CHAPTER_TYPE=E)."""
    accept = _read_csv_optional(base / "MBS_ACCEPTANCES.csv")
    reserves = _read_csv_optional(base / "MBS_RESERVES.csv")
    chapters = _read_csv_optional(base / "MBS_CHAPTERS.csv")
    sections = _read_csv_optional(base / "MBS_SECTIONS.csv")
    paragraphs = _read_csv_optional(base / "MBS_PARAGRAPH.csv")

    if accept.empty:
        return pay

    accept = accept.copy()
    accept["BUDGET_YEAR"] = pd.to_numeric(accept.get("BUDGET_YEAR"), errors="coerce")
    accept["ACCEPT_SEQ_YR"] = pd.to_numeric(accept.get("ACCEPT_SEQ_YR"), errors="coerce")
    accept["RESERVE_SEQ_YR"] = pd.to_numeric(accept.get("RESERVE_SEQ_YR"), errors="coerce")
    keep_a = [
        c for c in ["BUDGET_YEAR", "ACCEPT_SEQ_YR", "BENEFICIARY", "RESERVE_SEQ_YR"]
        if c in accept.columns
    ]
    accept = accept[keep_a].drop_duplicates(["BUDGET_YEAR", "ACCEPT_SEQ_YR"])
    accept = accept.rename(columns={"BENEFICIARY": "BENEFICIARY_ACCEPT"})
    pay = pay.merge(accept, on=["BUDGET_YEAR", "ACCEPT_SEQ_YR"], how="left")

    if reserves.empty or "RESERVE_SEQ_YR" not in pay.columns:
        return pay

    reserves = reserves.copy()
    reserves["BUDGET_YEAR"] = pd.to_numeric(reserves.get("BUDGET_YEAR"), errors="coerce")
    reserves["RESERVE_SEQ_YR"] = pd.to_numeric(reserves.get("RESERVE_SEQ_YR"), errors="coerce")
    reserves["CHAPTER"] = pd.to_numeric(reserves.get("CHAPTER"), errors="coerce")
    reserves["SECTION"] = pd.to_numeric(reserves.get("SECTION"), errors="coerce")
    keep_r = [
        c for c in [
            "BUDGET_YEAR", "RESERVE_SEQ_YR", "CHAPTER", "SECTION",
            "DESCRIPT", "BUDGET_TYPE",
        ]
        if c in reserves.columns
    ]
    reserves = reserves[keep_r].drop_duplicates(["BUDGET_YEAR", "RESERVE_SEQ_YR"])
    reserves = reserves.rename(columns={
        "CHAPTER": "BUDGET_CHAPTER",
        "SECTION": "BUDGET_SECTION",
        "DESCRIPT": "PURPOSE_RESERVE",
        "BUDGET_TYPE": "RESERVE_BUDGET_TYPE",
    })
    pay = pay.merge(reserves, on=["BUDGET_YEAR", "RESERVE_SEQ_YR"], how="left")

    # Official expense taxonomy labels (ignore reserve BUDGET_TYPE P/E for lookup).
    if not chapters.empty:
        chapters = chapters.copy()
        chapters["BUDGET_YEAR"] = pd.to_numeric(chapters.get("BUDGET_YEAR"), errors="coerce")
        chapters["CHAPTER"] = pd.to_numeric(chapters.get("CHAPTER"), errors="coerce")
        chapters = chapters[
            chapters.get("CHAPTER_TYPE", pd.Series(dtype=str)).astype(str).str.upper()
            == EXPENSE_CHAPTER_TYPE
        ]
        chapters = chapters.rename(columns={
            "CHAPTER": "BUDGET_CHAPTER",
            "DESCRIPT": "CHAPTER_DESC",
        })
        chapters = chapters[["BUDGET_YEAR", "BUDGET_CHAPTER", "CHAPTER_DESC"]].drop_duplicates(
            ["BUDGET_YEAR", "BUDGET_CHAPTER"]
        )
        pay = pay.merge(chapters, on=["BUDGET_YEAR", "BUDGET_CHAPTER"], how="left")

    if not sections.empty:
        sections = sections.copy()
        sections["BUDGET_YEAR"] = pd.to_numeric(sections.get("BUDGET_YEAR"), errors="coerce")
        sections["CHAPTER"] = pd.to_numeric(sections.get("CHAPTER"), errors="coerce")
        sections["SECTION"] = pd.to_numeric(sections.get("SECTION"), errors="coerce")
        sections = sections[
            sections.get("CHAPTER_TYPE", pd.Series(dtype=str)).astype(str).str.upper()
            == EXPENSE_CHAPTER_TYPE
        ]
        sections = sections.rename(columns={
            "CHAPTER": "BUDGET_CHAPTER",
            "SECTION": "BUDGET_SECTION",
            "DESCRIPT": "SECTION_DESC",
        })
        sections = sections[
            ["BUDGET_YEAR", "BUDGET_CHAPTER", "BUDGET_SECTION", "SECTION_DESC"]
        ].drop_duplicates(["BUDGET_YEAR", "BUDGET_CHAPTER", "BUDGET_SECTION"])
        pay = pay.merge(
            sections,
            on=["BUDGET_YEAR", "BUDGET_CHAPTER", "BUDGET_SECTION"],
            how="left",
        )

    if not paragraphs.empty and "PARAGRAPH" in pay.columns:
        paragraphs = paragraphs.copy()
        paragraphs["BUDGET_YEAR"] = pd.to_numeric(paragraphs.get("BUDGET_YEAR"), errors="coerce")
        paragraphs["CHAPTER"] = pd.to_numeric(paragraphs.get("CHAPTER"), errors="coerce")
        paragraphs["SECTION"] = pd.to_numeric(paragraphs.get("SECTION"), errors="coerce")
        paragraphs["PARAGRAPH"] = pd.to_numeric(paragraphs.get("PARAGRAPH"), errors="coerce")
        paragraphs = paragraphs[
            paragraphs.get("CHAPTER_TYPE", pd.Series(dtype=str)).astype(str).str.upper()
            == EXPENSE_CHAPTER_TYPE
        ]
        paragraphs = paragraphs.rename(columns={
            "CHAPTER": "BUDGET_CHAPTER",
            "SECTION": "BUDGET_SECTION",
            "PARAGRAPH": "PARAGRAPH",
            "DESCRIPT": "PARAGRAPH_DESC",
        })
        paragraphs = paragraphs[
            ["BUDGET_YEAR", "BUDGET_CHAPTER", "BUDGET_SECTION", "PARAGRAPH", "PARAGRAPH_DESC"]
        ].drop_duplicates(
            ["BUDGET_YEAR", "BUDGET_CHAPTER", "BUDGET_SECTION", "PARAGRAPH"]
        )
        pay = pay.merge(
            paragraphs,
            on=["BUDGET_YEAR", "BUDGET_CHAPTER", "BUDGET_SECTION", "PARAGRAPH"],
            how="left",
        )

    return pay


def build_muni_payment_ledger(data_dir: Path | None = None) -> list[dict[str, Any]]:
    """One record per MBS_PAYMENTS row. Empty list if export missing."""
    base = data_dir or DATA_DIR
    pay = _read_csv_optional(base / "MBS_PAYMENTS.csv")
    if pay.empty:
        return []

    orders = _read_csv_optional(base / "MBS_PAY_ORDER.csv")
    cash = _read_csv_optional(base / "MBS_CASH_DETAIL.csv")
    details = _read_csv_optional(base / "MBS_ACCEPT_DETAILS.csv")

    pay = pay.copy()
    pay["BUDGET_YEAR"] = pd.to_numeric(pay.get("BUDGET_YEAR"), errors="coerce")
    pay["AMOUNT"] = pd.to_numeric(pay.get("AMOUNT"), errors="coerce").fillna(0)
    pay["PAYMENT_SEQ_YR"] = pd.to_numeric(pay.get("PAYMENT_SEQ_YR"), errors="coerce")
    pay["ACCEPT_SEQ_YR"] = pd.to_numeric(pay.get("ACCEPT_SEQ_YR"), errors="coerce")
    pay["PARAGRAPH"] = pd.to_numeric(pay.get("PARAGRAPH"), errors="coerce")
    pay["PAY_DATE"] = pd.to_datetime(pay.get("PAY_DATE"), errors="coerce")
    if "ENTRY_DATE" in pay.columns:
        pay["ENTRY_DATE"] = pd.to_datetime(pay["ENTRY_DATE"], errors="coerce")
    if "ACTIVE" in pay.columns:
        inactive = pay["ACTIVE"].astype(str).str.upper().isin(["N", "0", "FALSE"])
        pay = pay[~inactive]

    pay = _attach_budget_taxonomy(pay, base)

    detail_agg = _prep_accept_details(details)
    if not detail_agg.empty:
        pay = pay.merge(detail_agg, on=["BUDGET_YEAR", "ACCEPT_SEQ_YR"], how="left")

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
        seq = int(r["PAYMENT_SEQ_YR"]) if pd.notna(r.get("PAYMENT_SEQ_YR")) else None
        # Skip void / empty payment shells.
        if amt <= 0 or seq is None or seq <= 0:
            continue
        pay_date = r.get("PAY_DATE")
        date_str = pay_date.strftime("%Y-%m-%d") if pd.notna(pay_date) else None
        if not date_str and pd.notna(r.get("ENTRY_DATE")):
            date_str = r["ENTRY_DATE"].strftime("%Y-%m-%d")

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

        chapter = int(r["BUDGET_CHAPTER"]) if pd.notna(r.get("BUDGET_CHAPTER")) else None
        section = int(r["BUDGET_SECTION"]) if pd.notna(r.get("BUDGET_SECTION")) else None
        paragraph = int(r["PARAGRAPH"]) if pd.notna(r.get("PARAGRAPH")) else None
        chapter_desc = _clean_str(r.get("CHAPTER_DESC"))
        section_desc = _clean_str(r.get("SECTION_DESC"))
        paragraph_desc = _clean_str(r.get("PARAGRAPH_DESC"))
        # Primary category = official section line (e.g. رواتب الموظفين / المحروقات)
        budget_category = section_desc or chapter_desc or paragraph_desc

        purpose = _clean_str(r.get("PURPOSE_RESERVE")) or _clean_str(r.get("PURPOSE_DETAIL"))
        purpose_lines = r.get("PURPOSE_LINES")
        if isinstance(purpose_lines, float) and pd.isna(purpose_lines):
            purpose_lines = None
        if purpose_lines is None:
            purpose_lines = []
        elif not isinstance(purpose_lines, list):
            purpose_lines = []

        code_parts = [str(x) for x in (chapter, section, paragraph) if x is not None]
        budget_code = ".".join(code_parts) if code_parts else None

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
            "chapter": chapter,
            "section": section,
            "paragraph": paragraph,
            "budget_code": budget_code,
            "chapter_desc": chapter_desc,
            "section_desc": section_desc,
            "paragraph_desc": paragraph_desc,
            "budget_category": budget_category,
            "purpose": purpose,
            "purpose_lines": purpose_lines,
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
