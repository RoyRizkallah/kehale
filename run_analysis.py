#!/usr/bin/env python3
"""CLI entry point — run structured Kehale municipal data analysis."""

from __future__ import annotations

import argparse
from pathlib import Path

from kehale_analytics.config import load_config, project_root
from kehale_analytics.reports.exporter import export_excel, export_markdown
from kehale_analytics.summary import run_full_analysis


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Kehale MONDAY_165 municipal revenue analysis (USD-normalized)"
    )
    parser.add_argument("--config", type=Path, default=None, help="Path to config.yaml")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root() / "output",
        help="Directory for Excel/Markdown reports",
    )
    args = parser.parse_args()

    cfg = load_config(args.config)
    print("Loading data and running analysis...")
    report = run_full_analysis(cfg)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    xlsx = export_excel(report, args.output_dir / "kehale_analysis.xlsx")
    md = export_markdown(report, args.output_dir / "kehale_analysis.md")

    print(f"\n=== Kehale Analysis Complete ===")
    print(f"Municipality: {report.municipality}")
    print(f"Years: {report.metadata.get('years_covered')}")
    print(f"Exchange rates:\n{report.exchange_rates.to_string(index=False)}")
    if not report.revenue_by_year.empty:
        print(f"\nRevenue by year (USD):\n{report.revenue_by_year[['year','total_usd','rate_source']].to_string(index=False)}")
    print(f"\nReports written:")
    print(f"  Excel: {xlsx}")
    print(f"  Markdown: {md}")


if __name__ == "__main__":
    main()
