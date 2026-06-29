"""Extract RUSUM_APPL_PARAMETERS and MBS_EXCHANGE rows from Oracle exp dump."""
import re
import struct
from pathlib import Path

DUMP = Path(__file__).resolve().parent.parent / "MONDAY_165.DMP"


def find_insert_block(data: bytes, table: str) -> list[int]:
    marker = f'INSERT INTO "{table}"'.encode()
    positions = []
    start = 0
    while True:
        idx = data.find(marker, start)
        if idx < 0:
            break
        positions.append(idx)
        start = idx + 1
    return positions


def extract_text_rows_after_insert(data: bytes, table: str, limit: int = 5000) -> None:
    positions = find_insert_block(data, table)
    print(f"{table}: {len(positions)} INSERT blocks")
    for pos in positions[:3]:
        chunk = data[pos : pos + limit]
        # printable run
        text = ""
        for b in chunk:
            if 32 <= b < 127 or b in (10, 13):
                text += chr(b)
            elif len(text) > 0 and text[-1] != " ":
                text += " "
        print("--- block ---")
        print(text[:1500])


def main():
    data = DUMP.read_bytes()
    for table in [
        "RUSUM_APPL_PARAMETERS",
        "MBS_EXCHANGE_ACCOUNT",
        "MONEY_UNITS",
        "BALADIEH_YEARS",
        "MBS_BUD_YEARS",
    ]:
        print("\n" + "=" * 60)
        extract_text_rows_after_insert(data, table)


if __name__ == "__main__":
    main()
