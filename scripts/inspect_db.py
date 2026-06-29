"""Inspect SQLite cache."""
import sqlite3
from pathlib import Path

db = Path(__file__).resolve().parent.parent / "data" / "kehale.db"
conn = sqlite3.connect(db)
tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("Tables:", tables)
for t in tables:
    n = conn.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    print(f"\n{t} ({n} rows)")
    rows = conn.execute(f"SELECT * FROM [{t}] LIMIT 5").fetchall()
    cols = [d[0] for d in conn.execute(f"SELECT * FROM [{t}] LIMIT 0").description]
    print("Columns:", cols)
    for r in rows:
        print(r)
