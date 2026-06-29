"""Extract CREATE TABLE DDL from Oracle classic exp dump (clean)."""
from pathlib import Path
import re

DUMP = Path(__file__).resolve().parent.parent / "MONDAY_165.DMP"

TABLES = [
    "BALADIEH_YEARS",
    "MBS_EXCHANGE_ACCOUNT",
    "MBS_EXCHANGE_ACCOUNT_LOG",
    "MONEY_UNITS",
    "RECEIPTS",
    "RECEIPTS_DET",
    "MRS_PAY_TRANSACTIONS",
    "MRS_PAY_TRANS",
    "FEE_TYPES",
    "TAKLEEFAT",
    "MBS_BUD_YEARS",
    "COLLECTION_ORDER",
    "BALADIAT",
    "RUSUM_APPL_PARAMETERS",
    "MBS_PAYMENTS",
    "MBS_PAY_TRANSACTIONS",
]


def extract_ddl(data: bytes, table: str) -> str | None:
    pat = f'CREATE TABLE "{table}"'.encode()
    idx = data.find(pat)
    if idx < 0:
        return None
    chunk = data[idx : idx + 12000]
    m = re.search(
        rb'CREATE TABLE.*?(?:TABLESPACE "[^"]+"\s+\w+(?:\s+\w+)*)',
        chunk,
        re.DOTALL,
    )
    if not m:
        return None
    return m.group(0).decode("latin-1", errors="replace")


def main():
    data = DUMP.read_bytes()
    lines = []
    for t in TABLES:
        ddl = extract_ddl(data, t)
        lines.append(f"=== {t} ===")
        lines.append(ddl or "NOT FOUND")
        lines.append("")
    text = "\n".join(lines)
    out_path = Path(__file__).parent / "schema_ddl.txt"
    out_path.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
