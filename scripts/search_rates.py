"""Search Oracle dump for rate/exchange related schema and parameters."""
import re
from pathlib import Path

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
    for t in ["PRV_YEARS", "MBS_ACC_YEAR", "MBS_SUBLEDGER_AMT_YR", "MBS_TMP_KATEH"]:
        print(extract_ddl(data, t))
        print()

    # Search parameter values mentioning exchange/dollar/lira
    for pat in [b"EXCH", b"DOLLAR", b"LIRA", b"LBP", b"SAYAR", b"USD", b"rate"]:
        print(f"\n--- snippets for {pat!r} ---")
        start = 0
        n = 0
        while n < 5:
            idx = data.find(pat, start)
            if idx < 0:
                break
            snippet = data[max(0, idx - 80) : idx + 120]
            text = "".join(
                chr(b) if 32 <= b < 127 else "." for b in snippet
            )
            print(text)
            start = idx + 1
            n += 1


if __name__ == "__main__":
    main()
