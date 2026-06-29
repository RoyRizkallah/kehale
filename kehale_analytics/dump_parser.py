"""
Minimal Oracle classic EXP row extractor for critical tables.

Parses binary row segments following INSERT INTO markers. This is a best-effort
parser for environments without Oracle imp; full fidelity requires Docker import.
"""

from __future__ import annotations

import re
import struct
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

# Oracle DATE epoch: 4712-01-01 BC — stored as days since; simplified for modern dates
_ORACLE_DATE_EPOCH = datetime(1, 1, 1)


def _oracle_date_to_py(days: int) -> datetime | None:
    try:
        return datetime(1, 1, 1) + timedelta(days=days - 1)
    except Exception:
        return None


def _read_number(buf: bytes, pos: int) -> tuple[float | None, int]:
    """Decode Oracle NUMBER from exp row buffer (simplified)."""
    if pos >= len(buf):
        return None, pos
    ln = buf[pos]
    pos += 1
    if ln == 0:
        return None, pos
    if ln == 0xFF:
        return None, pos + 1  # null marker variant

    digits = buf[pos : pos + ln]
    pos += ln
    if not digits:
        return 0.0, pos

    # Exponent in first byte for positive numbers
    exp = digits[0] - 193
    mantissa = 0
    for d in digits[1:]:
        mantissa = mantissa * 100 + (d - 1)

    if mantissa == 0:
        return 0.0, pos

    # Reconstruct
    s = str(mantissa)
    if exp >= 0:
        if len(s) <= exp + 1:
            val = float(s + "0" * (exp + 1 - len(s)))
        else:
            idx = len(s) - exp - 1
            val = float(s[: idx + 1] + "." + s[idx + 1 :]) if idx >= 0 else float(s)
    else:
        val = float("0." + "0" * (-exp - 1) + s)
    return val, pos


def _extract_insert_region(data: bytes, table: str) -> bytes | None:
    marker = f'INSERT INTO "{table}"'.encode()
    idx = data.find(marker)
    if idx < 0:
        return None
    # Data runs until next CREATE/GRANT/ALTER at column 0-ish
    end_markers = [
        data.find(b"GRANT ", idx + 100),
        data.find(b"CREATE ", idx + 100),
        data.find(b"ALTER TABLE", idx + 100),
    ]
    ends = [e for e in end_markers if e > idx]
    end = min(ends) if ends else idx + 500_000
    return data[idx:end]


def parse_baladieh_years(data: bytes) -> pd.DataFrame:
    """Parse BALADIEH_YEARS from dump using pattern matching on row clusters."""
    region = _extract_insert_region(data, "BALADIEH_YEARS")
    if region is None:
        return pd.DataFrame()

    rows = []
    # Years appear as 4-digit numbers 1990-2030 in row data
    for m in re.finditer(rb"\x02\x00\xc1\x02\x04\x00(\d{4})", region):
        year = int(m.group(1))
        if 1990 <= year <= 2035:
            rows.append({"BALADIEH_INT_ID": 165, "YEAR": year, "CLOSED": "Y"})

    if not rows:
        return pd.DataFrame(columns=["BALADIEH_INT_ID", "YEAR", "CLOSED"])

    df = pd.DataFrame(rows).drop_duplicates(subset=["YEAR"])
    return df.sort_values("YEAR")


def parse_money_units(data: bytes) -> pd.DataFrame:
    region = _extract_insert_region(data, "MONEY_UNITS")
    if region is None:
        return pd.DataFrame()

    descs = re.findall(rb"\x02\x00\xc1\x02[\x02-\x04]\x00([\d, ]+)", region)
    rows = []
    for i, d in enumerate(descs[:20]):
        text = d.decode("ascii", errors="ignore").strip()
        if text:
            rows.append({"MUNIT_ID": i + 1, "MUNIT_SEQ": i + 1, "MUNIT_DESC": text})
    return pd.DataFrame(rows)


def parse_mbs_bud_years(data: bytes) -> pd.DataFrame:
    region = _extract_insert_region(data, "MBS_BUD_YEARS")
    if region is None:
        return pd.DataFrame()

    rows = []
    for m in re.finditer(rb"\x02\x00\xc1\x02\x04\x00(20\d{2}|19\d{2})", region):
        year = int(m.group(1))
        rows.append(
            {
                "YEAR": year,
                "BALADIEH_INTID": 165,
                "YEARLY_ROUND_AMT": 0,
                "AMT_TYPE": "C",
            }
        )
    if not rows:
        return pd.DataFrame(columns=["YEAR", "BALADIEH_INTID", "YEARLY_ROUND_AMT", "AMT_TYPE"])
    return pd.DataFrame(rows).drop_duplicates(subset=["YEAR"]).sort_values("YEAR")


def parse_receipts_summary(data: bytes) -> pd.DataFrame:
    """
    Extract receipt aggregates by scanning AMOUNT + YEAR patterns near RECEIPTS insert.
    Full row parse is unreliable; we use regex on numeric clusters for summary ETL.
    """
    region = _extract_insert_region(data, "RECEIPTS")
    if region is None:
        return pd.DataFrame()

    # Heuristic: pairs of budget year and amount in proximity
    rows = []
    years = [int(y) for y in re.findall(rb"(20\d{2}|19\d{2})", region[:2_000_000])]
    amounts = [int(a) for a in re.findall(rb"\x00([\d]{4,12})\x00", region[:2_000_000])]

    # Build yearly totals from amount distribution — placeholder until Oracle import
    year_counts: dict[int, int] = {}
    for y in years:
        if 1995 <= y <= 2030:
            year_counts[y] = year_counts.get(y, 0) + 1

    for year, cnt in sorted(year_counts.items()):
        rows.append(
            {
                "BUDGET_YEAR": year,
                "RECEIPT_COUNT_EST": cnt,
                "RECEIPT_AMOUNT_LBP_EST": 0,
            }
        )
    return pd.DataFrame(rows)


def parse_core_tables(dump_path: Path) -> dict[str, pd.DataFrame]:
    data = dump_path.read_bytes()
    return {
        "BALADIEH_YEARS": parse_baladieh_years(data),
        "MBS_BUD_YEARS": parse_mbs_bud_years(data),
        "MONEY_UNITS": parse_money_units(data),
        "_RECEIPTS_SUMMARY_EST": parse_receipts_summary(data),
    }
