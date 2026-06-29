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
OUT_PAYMENTS = OUT_DIR / "payments.json"


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
    ledger = payload.pop("payment_ledger", [])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    OUT_PAYMENTS.write_text(
        json.dumps(_sanitize(ledger), ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {OUT_PAYMENTS} ({OUT_PAYMENTS.stat().st_size / 1024:.0f} KB, {len(ledger):,} payments)")


if __name__ == "__main__":
    main()
