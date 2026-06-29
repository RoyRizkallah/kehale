"""Export structured analysis to Excel and Markdown."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from kehale_analytics.summary import AnalysisReport


def _df_to_md(df: pd.DataFrame) -> str:
    if df.empty:
        return "_No data_"
    headers = "| " + " | ".join(df.columns) + " |"
    sep = "| " + " | ".join("---" for _ in df.columns) + " |"
    rows = ["| " + " | ".join(str(v) for v in row) + " |" for row in df.values]
    return "\n".join([headers, sep, *rows])


def export_excel(report: AnalysisReport, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        workbook = writer.book
        fmt_usd = workbook.add_format({"num_format": "$#,##0.00"})
        fmt_lbp = workbook.add_format({"num_format": "#,##0"})
        fmt_pct = workbook.add_format({"num_format": "0.00%"})

        # Overview sheet
        overview = pd.DataFrame(
            [
                ["Municipality", report.municipality],
                ["Site ID", report.site_id],
                ["Generated", report.generated_at],
                ["Data Source", report.data_source],
                ["Years Covered", ", ".join(map(str, report.metadata.get("years_covered", [])))],
                ["Total Revenue (USD)", report.metadata.get("total_receipt_usd", 0)],
            ],
            columns=["Metric", "Value"],
        )
        overview.to_excel(writer, sheet_name="Overview", index=False)

        report.exchange_rates.to_excel(writer, sheet_name="Exchange Rates", index=False)
        ws = writer.sheets["Exchange Rates"]
        ws.set_column("B:B", 14, fmt_lbp)

        if not report.revenue_by_year.empty:
            report.revenue_by_year.to_excel(writer, sheet_name="Revenue by Year", index=False)
            ws = writer.sheets["Revenue by Year"]
            ws.set_column("C:C", 16, fmt_lbp)
            ws.set_column("D:D", 16, fmt_usd)

        if not report.revenue_by_fee_type.empty:
            report.revenue_by_fee_type.to_excel(
                writer, sheet_name="Revenue by Fee Type", index=False
            )

        if not report.payment_transactions.empty:
            report.payment_transactions.to_excel(
                writer, sheet_name="Payment Transactions", index=False
            )

        if not report.budget_summary.empty:
            report.budget_summary.to_excel(writer, sheet_name="Budget Summary", index=False)

    return path


def export_markdown(report: AnalysisReport, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Kehale Municipal Data Analysis",
        f"",
        f"**Municipality:** {report.municipality}  ",
        f"**Site ID:** {report.site_id}  ",
        f"**Generated:** {report.generated_at}  ",
        f"**Data source:** {report.data_source}  ",
        f"",
        f"## 1. Exchange Rates (LBP per USD)",
        f"",
        _df_to_md(report.exchange_rates),
        f"",
        f"## 2. Revenue by Fiscal Year (USD)",
        f"",
    ]

    if not report.revenue_by_year.empty:
        display = report.revenue_by_year.copy()
        for col in ["total_lbp", "avg_receipt_lbp", "lbp_per_usd"]:
            if col in display.columns:
                display[col] = display[col].map(lambda x: f"{x:,.0f}")
        for col in ["total_usd", "avg_receipt_usd"]:
            if col in display.columns:
                display[col] = display[col].map(lambda x: f"${x:,.2f}")
        lines.append(_df_to_md(display))
    else:
        lines.append("_Receipt data requires full Oracle import._")

    lines.extend(["", "## 3. Metadata", "", f"```json", f"{report.metadata}", f"```", ""])
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
