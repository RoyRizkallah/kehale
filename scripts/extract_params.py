"""Extract application parameters and budget plan schema from dump."""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DUMP = Path(__file__).resolve().parent.parent / "MONDAY_165.DMP"


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
    return m.group(0).decode("latin-1", errors="replace") if m else None


def main():
    data = DUMP.read_bytes()
    for t in ["MBS_BUD_PLANS", "MBS_BUD_PLAN_INCOMES", "MBS_INCOMES_BUD", "MBS_EXPENSES_BUD"]:
        print(extract_ddl(data, t))
        print()

    idx = data.find(b'INSERT INTO "RUSUM_APPL_PARAMETERS"')
    chunk = data[idx : idx + 25000]
    strings = re.findall(rb"[\x20-\x7e]{4,}", chunk)
    for s in strings:
        t = s.decode("ascii")
        if any(
            k in t.upper()
            for k in ["EXCH", "RATE", "DOLLAR", "LIRA", "USD", "CURR", "SAYAR"]
        ):
            print("PARAM:", t)


if __name__ == "__main__":
    main()
