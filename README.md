# Khatha Sathi

**Team Human Intelligence** · **Build Bengaluru 2.0** · **PS2: Voice Khata for Kirana Stores**

A voice-first billing and udhaar (credit) ledger for kirana shopkeepers. The product brand in the UI is **CHOTU.ai**.

## Repository layout

| Folder | What it contains |
|---|---|
| [`frontend/`](frontend/) | React 18 + Vite + TypeScript web app (Landing, Log in, Sign up, Home dashboard, Terms/Privacy). See [`frontend/README.md`](frontend/README.md). |
| [`frontend/design-reference/`](frontend/design-reference/) | The approved Google Stitch exports the frontend is built from (source of truth for visuals). |
| `backend/` | FastAPI auth, inventory, customer ledger, transactions, reports, and Supabase Postgres access. |
| `supabase/` | The teammate-provided Supabase migrations and schema checks. See [`docs/DB_CONTRACT.md`](docs/DB_CONTRACT.md). |

## Quick start (full stack)

Start the backend in one terminal:

```powershell
cd backend
python -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Fill backend/.env with the private Supabase project values before starting.
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open **http://localhost:5173**. The backend is available at **http://localhost:8000**, with interactive API docs at **http://localhost:8000/docs**. The backend does not create tables or fall back to SQLite: without `DATABASE_URL`, database-backed routes return `503` while `/` and `/health` remain available. Set `OTP_MODE=dev` and `DEV_OTP_CODE` in `backend/.env` for local OTP testing.

The ignored `backend/khatha.db` file is legacy local data. It is not used by the Supabase backend and must be kept until its contents are backed up and its removal is separately approved. Never run the SQL files in `supabase/migrations/` against a project where they have already been applied.

Purchase recording and purchase-based report metrics remain unavailable until the teammate confirms how purchases should map to stock movements. The API returns `501` for purchase writes and `null` for purchase/profit report metrics rather than guessing.
