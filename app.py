"""Streamlit dashboard for Kehale municipal analytics."""

from __future__ import annotations

import streamlit as st
import plotly.express as px

from kehale_analytics.config import load_config
from kehale_analytics.summary import run_full_analysis

st.set_page_config(
    page_title="Kehale Municipal Analytics",
    page_icon="📊",
    layout="wide",
)

st.title("Kehale Municipal Revenue Analysis")
st.caption("MONDAY_165 — Municipal Revenue System (IDEAS/MRS) — all amounts normalized to USD")

with st.spinner("Loading database and computing analysis..."):
    cfg = load_config()
    report = run_full_analysis(cfg)

col1, col2, col3 = st.columns(3)
col1.metric("Site ID", report.site_id)
col2.metric("Fiscal Years", len(report.metadata.get("years_covered", [])))
col3.metric(
    "Total Revenue (USD)",
    f"${report.metadata.get('total_receipt_usd', 0):,.2f}",
)

st.divider()

tab_rates, tab_revenue, tab_fees, tab_budget, tab_data = st.tabs(
    ["Exchange Rates", "Revenue by Year", "Fee Types", "Budget", "Data Info"]
)

with tab_rates:
    st.subheader("LBP → USD Conversion Rate by Fiscal Year")
    st.dataframe(report.exchange_rates, use_container_width=True)
    fig = px.bar(
        report.exchange_rates,
        x="year",
        y="lbp_per_usd",
        color="source",
        title="Exchange Rate (LBP per 1 USD)",
        labels={"lbp_per_usd": "LBP / USD", "year": "Fiscal Year"},
    )
    st.plotly_chart(fig, use_container_width=True)

with tab_revenue:
    st.subheader("Annual Revenue (USD)")
    if report.revenue_by_year.empty:
        st.warning(
            "Full receipt data not yet loaded. Run Docker Oracle import for complete analysis."
        )
    else:
        st.dataframe(report.revenue_by_year, use_container_width=True)
        fig2 = px.line(
            report.revenue_by_year,
            x="year",
            y="total_usd",
            markers=True,
            title="Total Receipt Revenue (USD)",
        )
        st.plotly_chart(fig2, use_container_width=True)
        fig3 = px.bar(
            report.revenue_by_year,
            x="year",
            y="receipt_count",
            title="Receipt Count by Year",
        )
        st.plotly_chart(fig3, use_container_width=True)

with tab_fees:
    st.subheader("Revenue by Fee Type")
    if report.revenue_by_fee_type.empty:
        st.info("Fee/charge data requires full Oracle import (TAKLEEFAT table).")
    else:
        st.dataframe(report.revenue_by_fee_type, use_container_width=True)

with tab_budget:
    st.subheader("Budget vs Revenue")
    if report.budget_summary.empty:
        st.info("Budget tables require full Oracle import.")
    else:
        st.dataframe(report.budget_summary, use_container_width=True)

with tab_data:
    st.subheader("Data Provenance")
    st.write(f"**Source:** {report.data_source}")
    st.write(f"**Generated:** {report.generated_at}")
    st.write(f"**Tables in cache:** {len(report.tables_loaded)}")
    st.code(", ".join(report.tables_loaded))
