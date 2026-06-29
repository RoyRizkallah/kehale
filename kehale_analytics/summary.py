"""Master analysis orchestrator — produces structured report bundle."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from .analysis.revenue import (
    budget_summary,
    payment_transactions_summary,
    revenue_by_fee_type,
    revenue_by_year,
)
from .config import load_config, project_root
from .db import get_sqlite_connection, list_tables, table_exists
from .etl import ensure_data
from .exchange_rates import load_db_exchange_rates, resolve_rates


@dataclass
class AnalysisReport:
    generated_at: str
    municipality: str
    site_id: int
    data_source: str
    tables_loaded: list[str]
    exchange_rates: pd.DataFrame
    revenue_by_year: pd.DataFrame
    revenue_by_fee_type: pd.DataFrame
    payment_transactions: pd.DataFrame
    budget_summary: pd.DataFrame
    metadata: dict[str, Any] = field(default_factory=dict)


def discover_years(config: dict[str, Any]) -> list[int]:
    years: set[int] = set()
    with get_sqlite_connection(config) as conn:
        for table, col in [
            ("BALADIEH_YEARS", "YEAR"),
            ("MBS_BUD_YEARS", "YEAR"),
            ("RECEIPTS", "BUDGET_YEAR"),
            ("TAKLEEFAT", "BUDGET_YEAR"),
        ]:
            if table_exists(conn, table):
                try:
                    df = pd.read_sql(
                        f'SELECT DISTINCT "{col}" AS y FROM {table} WHERE "{col}" IS NOT NULL',
                        conn,
                    )
                    years.update(int(y) for y in df["y"] if 1990 <= int(y) <= 2035)
                except Exception:
                    pass
    if not years:
        bdl = config.get("exchange_rates", {}).get("bdl_official", {})
        years.update(int(y) for y in bdl)
    return sorted(years)


def run_full_analysis(config: dict[str, Any] | None = None) -> AnalysisReport:
    cfg = config or load_config()
    data_source = ensure_data(cfg)

    with get_sqlite_connection(cfg) as conn:
        tables = list_tables(conn)

    db_rates = pd.DataFrame()
    if cfg["database"]["oracle"].get("enabled"):
        from .db import get_oracle_connection

        with get_oracle_connection(cfg) as conn:
            db_rates = load_db_exchange_rates(conn)

    years = discover_years(cfg)
    rates = resolve_rates(years, cfg, db_rates)

    rev_year = revenue_by_year(cfg, rates)
    rev_fee = revenue_by_fee_type(cfg, rates)
    pay_trans = payment_transactions_summary(cfg, rates)
    budget = budget_summary(cfg, rates)

    meta = {
        "years_covered": years,
        "year_count": len(years),
        "has_full_receipts": "RECEIPTS" in tables and table_exists(
            get_sqlite_connection(cfg), "RECEIPTS"
        ),
        "total_receipt_usd": float(rev_year["total_usd"].sum()) if not rev_year.empty else 0,
    }

    return AnalysisReport(
        generated_at=datetime.now().isoformat(timespec="seconds"),
        municipality=cfg["analysis"]["municipality_name"],
        site_id=cfg["dump"]["site_id"],
        data_source=data_source,
        tables_loaded=tables,
        exchange_rates=rates,
        revenue_by_year=rev_year,
        revenue_by_fee_type=rev_fee,
        payment_transactions=pay_trans,
        budget_summary=budget,
        metadata=meta,
    )
