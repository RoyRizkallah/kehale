#!/usr/bin/env python3
"""Export dashboard JSON from municipal CSV data."""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kehale_analytics.payments import build_dashboard_payload

OUT_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "data"
OUT = OUT_DIR / "kehale.json"
# Legacy path: receipt/collections ledger (UI: Receivables)
OUT_RECEIPTS = OUT_DIR / "payments.json"
OUT_FEE_ALLOC = OUT_DIR / "receivables.json"
OUT_MUNI_PAY = OUT_DIR / "muni_payments.json"


def _sanitize(obj):
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        if obj == int(obj):
            return int(obj)
    return obj


def main() -> None:
    payload = _sanitize(build_dashboard_payload())
    receipts = payload.pop("payment_ledger", [])
    fee_alloc = payload.pop("receivable_ledger", [])
    muni_pay = payload.pop("muni_payment_ledger", [])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    OUT_RECEIPTS.write_text(
        json.dumps(_sanitize(receipts), ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    OUT_FEE_ALLOC.write_text(
        json.dumps(_sanitize(fee_alloc), ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    OUT_MUNI_PAY.write_text(
        json.dumps(_sanitize(muni_pay), ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {OUT_RECEIPTS} ({OUT_RECEIPTS.stat().st_size / 1024:.0f} KB, {len(receipts):,} receipts/receivables)")
    print(f"Wrote {OUT_FEE_ALLOC} ({OUT_FEE_ALLOC.stat().st_size / 1024:.0f} KB, {len(fee_alloc):,} fee-allocation records)")
    print(f"Wrote {OUT_MUNI_PAY} ({OUT_MUNI_PAY.stat().st_size / 1024:.0f} KB, {len(muni_pay):,} municipal payments)")


if __name__ == "__main__":
    main()
