"""Find all CREATE TABLE statements with RATE or EXCH in column definitions."""
import re
from pathlib import Path

DUMP = Path(__file__).resolve().parent.parent / "MONDAY_165.DMP"
data = DUMP.read_bytes()

for m in re.finditer(rb'CREATE TABLE "([A-Z0-9_$]+)" \((.*?)\)\s+PCTFREE', data, re.DOTALL):
    name = m.group(1).decode()
    cols = m.group(2).decode("latin-1", errors="replace")
    upper = cols.upper()
    if "RATE" in upper or "EXCH" in upper or "CURR" in upper or "DOLLAR" in upper:
        print(f"=== {name} ===")
        print(cols[:800])
        print()
