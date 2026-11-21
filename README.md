# Khatha Sathi

**Team Human Intelligence** · **Build Bengaluru 2.0** · **PS2: Voice Khata for Kirana Stores**

A voice-first billing and udhaar (credit) ledger for kirana shopkeepers. The product brand in the UI is **CHOTU.ai**.

## Run it in 5 minutes

You need **Python 3.12+**, **Node 20+** and the private Supabase values from the team lead (never commit them).

1. Clone the repo, then from its root run:

   ```powershell
   # Windows (PowerShell)
   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
   ```

   ```bash
   # macOS / Linux / Git Bash
   bash scripts/dev.sh
   ```

2. The first run creates `backend/.venv`, installs packages and copies `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env`.
3. Fill `backend/.env` with the Supabase values. Every variable is explained in [`backend/.env.example`](backend/.env.example). Then run the script again.
4. Open **http://localhost:5173** and log in as the demo shop (`demo@chotu.shop`; the team lead has the password).
   - The API runs at **http://127.0.0.1:8000**, with docs at **/docs**.
   - `GET /health/ready` checks the database connection.

**Voice works without credits by default:**
- The frontend uses the voice mock (`VITE_USE_MOCK_VOICE=true`).
- The backend uses mock speech providers (`ASR_PROVIDER=mock`, `TTS_PROVIDER=mock`).
- To use real Gnani speech, put `GNANI_API_KEY` in `backend/.env` and set both providers to `gnani`. See [`docs/GNANI_NOTES.md`](docs/GNANI_NOTES.md).

**Want the UI only, with no backend?** Set `VITE_USE_MOCK_API=true` in `frontend/.env` and run `npm run dev` in `frontend/`.

## Architecture

```
Browser (React 18 + Vite + TS)            FastAPI backend (backend/)                Supabase (Seoul)
 ─ pages: Home, Products, Customers,  ──►  ─ verifies the Supabase JWT (JWKS)   ──►  ─ Postgres: shops, products,
   Assistant (voice), Settings…   HTTPS    ─ scopes every query by shop_id           customers, ledger_entries,
 ─ services/api.ts (one client,            ─ money in integer paise                  ledger_items, stock_movements,
   refreshes tokens on 401)                ─ append-only ledger (undo = reversal)    assistant_drafts, voice_usage
 ─ never calls Gnani directly              ─ /voice/*: speech → rules parser     ─ RLS on every table
                                             → draft → confirm (only write)      ─ Auth (email / phone OTP)
                                           ─ Gnani STT/TTS via backend only  ──►  Gnani Vachana API
```

- **Frontend** ([`frontend/`](frontend/)): React app. All network calls go through [`frontend/src/services/api.ts`](frontend/src/services/api.ts). The pages are built from the approved Stitch designs in [`frontend/design-reference/`](frontend/design-reference/). See [`frontend/README.md`](frontend/README.md).
- **Backend** ([`backend/`](backend/)):
  - [`main.py`](backend/main.py): auth, products, customers, ledger, reports and WhatsApp reminder links.
  - [`backend/voice/`](backend/voice/): the voice assistant.
- **Database** ([`supabase/`](supabase/)):
  - `migrations/`: the migrations, already applied. **Never re-run them** on a project that already has them.
  - `seed.sql`: the demo data.
  - `tests/phase1_checks.sql`: checks for the database rules.
- **Ledger rules:**
  - Balances change only through bills, payments, undo (a reversal entry) or the opening balance entered once when a customer is created.
  - A payment above the due amount is refused.

**Contracts:**
- [`docs/DB_CONTRACT.md`](docs/DB_CONTRACT.md): tables, rules and how to connect.
- [`docs/VOICE_CONTRACT.md`](docs/VOICE_CONTRACT.md): the `/voice/*` API.
- [`docs/GNANI_NOTES.md`](docs/GNANI_NOTES.md): Gnani facts and credit limits.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): branches, commits, tests and secrets.

**Data location.** The current Supabase project is in ap-northeast-2 (Seoul). For production, the database will be hosted in ap-south-1 (Mumbai) for DPDP data-localisation compliance.

## Tests

```bash
cd backend && python -m pytest -q          # mock providers, no database or credits needed
cd frontend && npm run lint && npm run test:assistant && npm run test:shell
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same checks on every push and pull request, with no secrets.

## Known gaps

- **Purchases.** Purchase recording and purchase-based report metrics wait for the team to decide how purchases map to stock movements. Until then the API returns `501` for purchase writes and `null` for purchase/profit metrics, rather than guessing.
- **Legacy local file.** `backend/khatha.db` is old local data and is ignored by git. The Supabase backend doesn't use it. Keep it until its contents are backed up and its removal is approved.
