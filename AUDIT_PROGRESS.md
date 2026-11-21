# Audit progress: CHOTU.ai / Khatha Sathi

Work branch `audit/full-check` (from `origin/main` @ `8514ef2`), worktree `../KhathaSathi-audit`.
The uncommitted Chotu LLM work on `feature/chotu-llm` (`KhathaSathi-fresh`) is untouched. Evidence: `audit-evidence/` (gitignored).
Scope was narrowed on 22 Nov to "a working demo": deep cleanup and cosmetic work were skipped on purpose.

## Status (22 Nov)
| Step | Status |
|---|---|
| Live DB checks + login + Customers/Products with search in the browser | ✅ |
| Payment + Customer history screens | ✅ |
| Voice end-to-end + one live Gnani STT/TTS | ✅ (approved, done once) |
| `rashmitha-final` `/quick-update` with 4 fixes | ✅ (commit `00ce810`, co-authored) |
| PR into `main` | ⏳ needs your approval |

## Database: root cause
1. `backend/.env` was an unfilled copy of `.env.example` (placeholders). Fixed by you.
2. Then, in the filled file, two lines had the name pasted twice: `SUPABASE_URL=SUPABASE_URL=…` and
   `DATABASE_URL=DATABASE_URL=…`. **Still present in `KhathaSathi-fresh/backend/.env`: please fix both lines.**
   (Fixed only in the audit worktree's copy.) The backend now names both mistakes at start-up.

The live DB itself was healthy throughout: 9/9 migrations applied, RLS on every table, append-only triggers, private buckets.

## Evidence
| Check | Result |
|---|---|
| `GET /health/ready` | 200 `database: connected` |
| demo login email / phone / wrong password | 200 / 200 / 401 |
| `pytest test_live.py` (LIVE_TESTS=1) | 4/4 |
| `supabase/tests/phase1_checks.sql` (full, incl. write-blocking; one transaction, rolled back) | **20/20**; counts unchanged afterwards |
| API journey, new test user (`audit.test.20261122@chotu.shop`) | 49 checks pass (one informational: fuzzy `rmesh` matched in the demo shop but not in a 1-customer shop) |
| Browser walkthrough, real mode (`scripts/e2e-real.ts`, opt-in) | **30/30**: sign-up, products + search, customers + search by phone, voice bill → Confirm → DB, history + items, payment with Confirm (over-due refused), report issue + My reports, profile, logout/login persistence (new user and demo), no sideways scroll on 13 pages × 5 widths, no console errors / failed requests |
| DB row of the confirmed voice bill | `source=voice`, transcript saved, 2 × Tata Salt = 5600 paise udhaar, stock 10 → 8, balance 9600 |
| Live Gnani (approved) | STT 200, 3.3 s, transcript exact "Ramesh ka balance kitna hai?" → answer ₹840 from DB; TTS 200, 1.5 s, 24 KB MP3. **Usage: 2 calls, 2.80 s audio + 25 characters** (`voice_usage`). Exact credits: app.gnani.ai/voice. Backend back on mock. |
| backend pytest | 134 passed, 4 skipped (live, opt-in) |
| frontend lint / `tsc -b` + build | pass |
| `test:assistant` / `test:shell` / interactions | 35/35 / 25/25 (3 runs in a row, flake fixed) / 38/38 |
| visual (Landing/Login/Signup vs Stitch, **Terms/Privacy vs committed baseline**) | 25/25 rows at 0.0000 % |
| secret scan, full history | clean |

## Bugs found and fixed
- **Voice: "Ramesh ko 500 rupaye udhaar diya" became a PAYMENT** (opposite direction). Fixed in the backend parser and the browser mock; it now explains udhaar needs items.
- Config diagnostics: placeholders and doubled names are reported by name (never values).
- Mock mode: Products/Customers sent a fake token to the backend. Now they show a clear message.
- Home: Quick View / Analytics / Notifications were label-only toasts. Now "… is coming soon".
- `.sr-only` didn't apply on the Customers/Products pages ("Actions" header was visible).
- Flaky shell check (`aria-current` read before React re-rendered).
- `rashmitha-final`: undone sales counted, UTC days, `custom` ignored, part-paid lost; `payment_mode` NameError (dropped); CORS regex (dropped).

## Added
- `/customers/:id`: balance, history (newest first, bill items), record payment (cash/UPI, Confirm step, max = due), "use the assistant to create a bill".
- Search boxes on Customers (name, fuzzy, phone digits) and Products (name, fuzzy, aliases) via `GET /search`.
- `GET /quick-update` (backend only; there's no Quick View screen yet, so the Home card still says "coming soon").
- `frontend/visual-baseline/` + `--update-baseline`; `frontend/scripts/e2e-real.ts` (opt-in, writes to the DB).

## Known gaps (not fixed, by scope)
- Products added in the UI can't get aliases (no field), so Hindi names like "namak" only work for seeded products.
- No real SMS OTP provider (`OTP_MODE=dev` only). Not production-ready for public sign-up.
- No bill creation screen (voice only, as agreed). Reports/dashboard/quick-update have no screens.
- Leaked-password protection: you'll toggle it in the dashboard.
- Test data left in the live DB (append-only ledger): `audit.test.20261122@chotu.shop`, `e2e.202611212211/13/18/20@chotu.shop`. Only those shops contain test rows.
- TTS reads "₹840" as written; Gnani recommends numbers as words. Not verified by ear.
- Bundle 507 kB (warning only).
