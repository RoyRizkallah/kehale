"""Configuration loader for Kehale analytics."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config.yaml"


def _default_config() -> dict[str, Any]:
    return {
        "dump": {"path": "MONDAY_165.DMP", "site_id": 165},
        "analysis": {"municipality_name": "Al-Kahaleh (Site 165)"},
        "database": {
            "sqlite_path": "data/kehale.db",
            "oracle": {
                "enabled": False,
                "user": "RUSUM",
                "password": "rusum",
                "dsn": "localhost:1521/XE",
            },
        },
        "exchange_rates": {
            "source_priority": ["database", "config", "bdl_official"],
            "bdl_official": {str(y): 1507.5 for y in range(2000, 2023)}
            | {str(y): 89500.0 for y in range(2023, 2027)},
            "overrides": {},
        },
    }


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: Path | None = None) -> dict[str, Any]:
    cfg_path = path or DEFAULT_CONFIG
    cfg = _default_config()
    if cfg_path.exists() and cfg_path.stat().st_size > 0:
        with cfg_path.open(encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
        cfg = _deep_merge(cfg, loaded)

    import os

    if os.getenv("ORACLE_ENABLED", "").lower() in ("1", "true", "yes"):
        cfg["database"]["oracle"]["enabled"] = True
    if os.getenv("ORACLE_USER"):
        cfg["database"]["oracle"]["user"] = os.environ["ORACLE_USER"]
    if os.getenv("ORACLE_PASSWORD"):
        cfg["database"]["oracle"]["password"] = os.environ["ORACLE_PASSWORD"]
    if os.getenv("ORACLE_DSN"):
        cfg["database"]["oracle"]["dsn"] = os.environ["ORACLE_DSN"]
    return cfg


def project_root() -> Path:
    return ROOT
