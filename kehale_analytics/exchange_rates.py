"""LBP → USD exchange rate resolution by fiscal year."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class YearRate:
    year: int
    lbp_per_usd: float
    source: str


def _bdl_rate(year: int, bdl_table: dict[int | str, float]) -> float | None:
    if year in bdl_table:
        return float(bdl_table[year])
    if str(year) in bdl_table:
        return float(bdl_table[str(year)])
    return None


def resolve_rates(
    years: list[int],
    config: dict[str, Any],
    db_rates: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Build authoritative year → USD rate table with source tracking."""
    exch_cfg = config.get("exchange_rates", {})
    overrides = exch_cfg.get("overrides", {}) or {}
    bdl = exch_cfg.get("bdl_official", {}) or {}
    priority = exch_cfg.get("source_priority", ["database", "config", "bdl_official"])

    db_map: dict[int, tuple[float, str]] = {}
    if db_rates is not None and not db_rates.empty:
        for _, row in db_rates.iterrows():
            yr = int(row["year"])
            db_map[yr] = (float(row["lbp_per_usd"]), str(row.get("source", "database")))

    rows: list[dict[str, Any]] = []
    for year in sorted(set(years)):
        rate: float | None = None
        source = "unknown"

        for src in priority:
            if src == "database" and year in db_map:
                rate, source = db_map[year]
                break
            if src == "config":
                ov = overrides.get(year) or overrides.get(str(year))
                if ov is not None:
                    rate, source = float(ov), "config_override"
                    break
            if src == "bdl_official":
                bdl_val = _bdl_rate(year, bdl)
                if bdl_val is not None:
                    rate, source = bdl_val, "bdl_official"
                    break

        if rate is None:
            # Nearest prior year from BdL table
            prior = [y for y in bdl if int(y) <= year]
            if prior:
                nearest = max(prior, key=lambda y: int(y))
                rate = float(bdl[nearest])
                source = f"bdl_official_carry_forward_{nearest}"

        if rate is None:
            rate, source = 1507.5, "default_pegged"

        rows.append(
            {
                "year": year,
                "lbp_per_usd": rate,
                "usd_per_lbp": 1.0 / rate,
                "source": source,
            }
        )

    return pd.DataFrame(rows)


def to_usd(amount_lbp: pd.Series, year: pd.Series, rates: pd.DataFrame) -> pd.Series:
    """Convert LBP amounts to USD using per-row fiscal year."""
    rate_map = rates.set_index("year")["lbp_per_usd"]
    lbp_per_usd = year.map(rate_map)
    return amount_lbp / lbp_per_usd


def load_db_exchange_rates(conn) -> pd.DataFrame:
    """
    Attempt to load exchange rates from known MRS/MBSA tables.
    Returns empty DataFrame if not available.
    """
    queries = [
        """
        SELECT BUDGET_YEAR AS year, EXCHANGE_RATE AS lbp_per_usd, 'MBS_EXCHANGE_RATE' AS source
        FROM MBS_EXCHANGE_RATE
        """,
        """
        SELECT BUDGET_YEAR AS year, RATE AS lbp_per_usd, 'MBS_EXCHANGE_ACCOUNT' AS source
        FROM MBS_EXCHANGE_ACCOUNT
        WHERE RATE IS NOT NULL
        """,
        """
        SELECT TO_NUMBER(APPL_PAR_VALUE) AS lbp_per_usd,
               TO_NUMBER(REGEXP_SUBSTR(APPL_PAR_NAME, '[0-9]{4}')) AS year,
               'RUSUM_APPL_PARAMETERS' AS source
        FROM RUSUM_APPL_PARAMETERS
        WHERE UPPER(APPL_PAR_CATEGORY) LIKE '%EXCH%'
           OR UPPER(APPL_PAR_NAME) LIKE '%EXCH%'
           OR UPPER(APPL_PAR_NAME) LIKE '%RATE%'
        """,
    ]

    import pandas as pd

    for sql in queries:
        try:
            df = pd.read_sql(sql, conn)
            if not df.empty and "year" in df.columns and "lbp_per_usd" in df.columns:
                df = df.dropna(subset=["year", "lbp_per_usd"])
                df["year"] = df["year"].astype(int)
                return df.groupby("year", as_index=False).first()
        except Exception:
            continue
    return pd.DataFrame(columns=["year", "lbp_per_usd", "source"])
