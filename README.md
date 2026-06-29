# Kehale

Municipal revenue monitor for **Al-Kahaleh (Site 165)** — payments, receivables, categories, USD-normalized.

**Live dashboard password:** `Welcome@123!`

## Deploy on Render

1. Push this repo to GitHub
2. [Render](https://render.com) → **New Static Site** → connect `RoyRizkallah/kehale`
3. Settings (or use `render.yaml`):
   - **Publish directory:** `dashboard`
   - **Build command:** (leave empty)
4. Deploy → open your Render URL → sign in with password above

Or use the included `render.yaml` blueprint for one-click deploy.

## Local dashboard

```powershell
serve-local.bat
# → http://localhost:8080
```

Regenerate data: `python scripts/build_dashboard_json.py`

---


No local Python or Oracle install needed.

### Full stack (Oracle + import + analytics + dashboard)

```powershell
cd C:\Users\User\Downloads\Kehale
docker-start.bat
# or: docker compose up -d --build
```

### Lite stack (dashboard + CSV analytics — no Oracle)

Use when disk is low or Oracle import is not needed:

```powershell
docker compose -f docker-compose.lite.yml up -d --build
```

| Service | Role |
|---------|------|
| **oracle** | Oracle XE database (full stack only) |
| **oracle-import** | Imports RUSUM + MBSSMALL from `.DMP` |
| **analytics** | ETL → SQLite → CSV → reports → dashboard JSON |
| **dashboard** | Nginx on port **8080** |

- **Dashboard:** http://localhost:8080  
- **Health check:** `check-stack.bat`  
- **Docker broken?** Use `serve-local.bat` (Python server, same port)

### Troubleshooting Docker

If you see `500 Internal Server Error` from `dockerDesktopLinuxEngine`:

1. **Free disk space** — need at least **8 GB** free on `C:` (Oracle needs more inside Docker)
2. Open **Docker Desktop** and wait until it shows "Running"
3. Run: `wsl --shutdown` then restart Docker Desktop
4. Use lite stack or `serve-local.bat` while fixing Docker

```powershell
docker compose logs -f oracle-import   # watch import
docker compose logs -f analytics       # watch pipeline
docker compose exec analytics /app/docker/entrypoint.sh  # re-run analysis
```

---

## Local run (without Docker)

```powershell
pip install -r requirements.txt
python run_analysis.py
python scripts/build_dashboard_json.py
cd dashboard && python -m http.server 8765
```

Uses `municipal_analysis/*.csv` exports. Full data requires Docker Oracle import.

---

## Outputs

| Path | Content |
|------|---------|
| `output/kehale_analysis.xlsx` | Multi-sheet Excel report |
| `output/kehale_analysis.md` | Markdown summary |
| `dashboard/data/kehale.json` | Dashboard data (payments, receivables, categories) |
| `data/kehale.db` | SQLite cache from Oracle ETL |

---

## Config

`config.yaml` — exchange rates, paths, municipality name. In Docker, Oracle is enabled via environment variables in `docker-compose.yml`.

---

## Project layout

```
Kehale/
├── docker-compose.yml      # Full stack
├── docker/
│   ├── Dockerfile          # Analytics image
│   ├── entrypoint.sh       # ETL + reports + dashboard JSON
│   └── import-remote.sh    # Oracle imp sidecar
├── dashboard/              # Cinematic UI (index.html + app.js)
├── kehale_analytics/       # Python library
├── MONDAY_165.DMP          # Oracle source dump
└── config.yaml
```
