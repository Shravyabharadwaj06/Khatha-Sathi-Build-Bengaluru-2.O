# Khatha Sathi

**Team Human Intelligence** · **Build Bengaluru 2.0** · **PS2: Voice Khata for Kirana Stores**

A voice-first billing and udhaar (credit) ledger for kirana shopkeepers. The product brand in the UI is **CHOTU.ai**.

## Repository layout

| Folder | What it contains |
|---|---|
| [`frontend/`](frontend/) | React 18 + Vite + TypeScript web app (Landing, Log in, Sign up, Home dashboard, Terms/Privacy). See [`frontend/README.md`](frontend/README.md). |
| [`frontend/design-reference/`](frontend/design-reference/) | The approved Google Stitch exports the frontend is built from (source of truth for visuals). |
| `backend/` | FastAPI auth, inventory, customer ledger, transactions, reports, and SQLite persistence. |

## Quick start (full stack)

Start the backend in one terminal:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open **http://localhost:5173**. The backend is available at **http://localhost:8000** and its interactive API docs at **http://localhost:8000/docs**. SQLite database tables are created automatically in `backend/khatha.db`. Create an account in the app; the local development OTP is **123456**.
