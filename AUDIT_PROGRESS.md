# Audit progress: CHOTU.ai / Khatha Sathi

Work branch: `audit/full-check` (from `origin/main` @ `8514ef2`), in a separate worktree `../KhathaSathi-audit`,
so the uncommitted Chotu LLM work on `feature/chotu-llm` in `KhathaSathi-fresh` is untouched.
Evidence: `audit-evidence/` (gitignored). Never commit `.env` files.

| Phase | Status |
|---|---|
| 1 Inspection / inventory | ✅ done |
| 2 Database | ✅ root cause found + diagnostics fixed; ⏳ live API run needs the real `backend/.env` (you) |
| 3 Gnani | ✅ code vs current docs verified; ⏳ live STT+TTS call needs approval + key |
| 4 Env files | ✅ templates checked against code, backend template clarified |
| 5 Frontend audit | 🟡 automated checks done; dead buttons labelled; manual pass + real-mode browser run pending |
| 6 Backend/API | 🟡 endpoints read; shop scoping OK; see findings |
| 7 E2E | ⏳ blocked on real `backend/.env` |
| 8 Cleanup/security | 🟡 secret scan clean; cleanup not started |
| 9 Branches | 🟡 `rashmitha-final` reviewed (findings below), not integrated |
| 10 Report | ⏳ |

## Next step (exact)
1. You fill `KhathaSathi-fresh/backend/.env` (see "Env" below), keeping `OTP_MODE=dev` with a 6-digit `DEV_OTP_CODE`.
2. Copy it to `../KhathaSathi-audit/backend/.env`, start the backend from the audit worktree, run
   `GET /health/ready` → expect 200, then `LIVE_TESTS=1 LIVE_DEMO_PASSWORD=Demo@1234 pytest test_live.py`.
3. Then do the Phase 7 browser journey in real mode (demo user + a new `audit+<date>@` test user).

## Phase 1–2: database "not working": root cause
**Root cause (reproduced):** `backend/.env` is a byte-for-byte copy of `backend/.env.example` (same SHA-256).
`scripts/dev.ps1` creates it on the first run and asks for it to be filled in; that never happened. So
`DATABASE_URL`, `SUPABASE_URL` and both keys are the literal `<...>` placeholders, and `DEV_OTP_CODE=<six-digit-code>`.
Backend evidence (port 8001, `audit-evidence/backend-placeholder.err.log`):

| Request | Response |
|---|---|
| `GET /health` | 200 `{"status":"ok"}` |
| `GET /health/ready` | 503 "Database operation failed" ← log: `failed to resolve host 'aws-<N>-ap-northeast-2.pooler.supabase.com'` |
| `POST /auth/login` demo email | 502 "Supabase Auth sign-in failed." (URL is `https://<project-ref>.supabase.co`) |
| `POST /auth/login` demo phone | 503 (DB lookup of the phone fails, same DNS error) |
| `POST /auth/otp/send` | 503 "Set a six-digit DEV_OTP_CODE" |

`frontend/.env` = copy of the example: `VITE_USE_MOCK_API=false` (real API), `VITE_USE_MOCK_VOICE=true`, `VITE_VOICE_INPUT=browser`.

Your 10-cause checklist:
1. ✅ Frontend is in real mode for the API (but voice is mock and browser speech, so Gnani is never called).
2. ❌ `backend/.env` exists and loads (dotenv path = `backend/.env`, fine) but is **unfilled**. **ROOT CAUSE.**
3. ❌ `DATABASE_URL` is a placeholder. The template itself is right (`postgresql+psycopg://`, session pooler, 5432, `sslmode=require`).
4. ❌ Keys / `SUPABASE_URL` are placeholders. Live URL is `https://asndlkpodgwmtmulgthy.supabase.co`.
5. ⏳ JWT (ES256, aud `authenticated`, iss `<url>/auth/v1`, JWKS): can only be tested once 2–4 are fixed.
6. ✅ No half-signed-up users: 2 auth users, both with profile + shop + settings.
7. ✅ `CORS_ORIGINS` = `http://localhost:5173,http://127.0.0.1:5173` matches Vite's default port.
8. 🟡 Contract: the pages that exist match the backend (rupees in REST, paise in voice). Gaps listed below.
9. ✅ All 9 repo migrations are applied on the live project (names + versions match).
10. ✅ Errors are logged with the real Postgres message (the log line above came from the handler).

**Database itself: healthy.** Read-only checks via MCP (evidence in the chat log of 22 Nov):
- `phase1_checks.sql` read-only parts: Ramesh = 84000 paise; explain sums to 84000; 2 Ravis; aliases
  (`tata namak` → Tata Salt 1kg, `fortune tel` → Fortune Sunflower Oil 1L); 5 old dues; legacy total 590363;
  low stock = Parachute, Tomato. All PASS.
- The full script was **declined** by the MCP/approval (it contains UPDATE/DELETE inside rolled-back blocks).
  The append-only / reversal / sale-total checks (5–5.4) are still to run, through the API or with your approval.
- RLS: demo user sees 11 own customers, 0 of the other shop (customers, entries, balances, RPC); anon has no
  table or function privilege; `authenticated` has no `legacy` usage; every public table has RLS; no DELETE policies;
  append-only triggers on ledger_entries / ledger_items / stock_movements / audit_log; view `security_invoker`;
  functions `search_path=''`; 3 buckets private.
- Advisors: security = 1 WARN (leaked-password protection off; a dashboard toggle). Performance = 17 INFO unused indexes (no traffic yet).
- Not in the schema (by design): `bills`, `bill_items`, `payments`, `shop_members`, `customer_aliases`, owner/manager/staff roles.
- Backend connects as `postgres` via the pooler (bypasses RLS); every query in `main.py` filters by `context.shop_id`. Checked by reading every endpoint.

**Fix made (diagnostics, no behaviour change for real values):** `<...>` placeholders now count as "not configured":
`database.py` gives a clear `DATABASE_CONFIG_ERROR`; `supabase_client._setting` raises "still has the placeholder";
`main.config_problems()` logs the names (never values) at start-up. Tests: `test_api.py` (+3).

## Phase 1: feature inventory
| Feature | UI | Backend | DB | Works? |
|---|---|---|---|---|
| Landing, Terms, Privacy | ✅ | n/a | n/a | ✅ (visual 0% for Landing; Terms/Privacy **not in the visual suite**) |
| Sign up + dev OTP | ✅ | ✅ | ✅ | ⏳ blocked by env. No real SMS provider implemented (`OTP_MODE=dev` only) |
| Log in (phone/email), refresh, logout | ✅ | ✅ | ✅ | ⏳ blocked by env |
| Forgot PIN | toast "coming soon" | ❌ | n/a | labelled, OK |
| Home cards | ✅ | n/a | n/a | Quick View / Analytics / Notifications were label-only toasts → now "… is coming soon" |
| Products CRUD (archive) | ✅ | ✅ | ✅ | ⏳ env. No search box in the UI |
| Customers CRUD + opening balance + WhatsApp reminder link | ✅ | ✅ | ✅ | ⏳ env. No search box in the UI |
| Bills (sale) | ❌ **no UI** | ✅ `POST /transactions` | ✅ | only through the voice assistant |
| Payments | ❌ **no UI** | ✅ `POST /payments` (refuses > due) | ✅ | only through the voice assistant |
| Transaction history / customer ledger | ❌ **no UI** | ✅ `/transactions`, `/customers/{id}/ledger` | ✅ | API only |
| Reports (stock, sales), `/dashboard`, `/search` | ❌ **no UI** | ✅ | ✅ | API only |
| Quick Update dashboard | ❌ | only on `rashmitha-final` (`/quick-update`) | ✅ | see Phase 9 |
| Voice assistant | ✅ | ✅ `/voice/*` | drafts, usage | mock ✅ 35/35; real ⏳ |
| Profile + avatar + settings | ✅ | ✅ | ✅ + `avatars` bucket | ⏳ env |
| Report issue / My reports (photos) | ✅ | ✅ | ✅ + bucket | ⏳ env |
| Reminders table, notebook imports, `khata-scans` | ❌ | ❌ | tables only | schema only |
| i18n (en/hi/kn/ur) + optional IndicTrans2 | ✅ | `/api/translate` **does not exist** in backend | n/a | falls back to locale files |
| Mock mode | — | — | — | Products/Customers had no mock and sent a fake token to :8000 → now a clear "needs the backend" message |

## Phase 3: Gnani
Code (`backend/voice/providers.py`) was compared with the current docs.gnani.ai (STT REST, TTS inference, voices, quick start)
on 22 Nov and **matches**: `POST https://api.vachana.ai/stt/v3` multipart `audio_file`/`language_code`/`model=prisma-v3.0`/
`format=transliterate`; header `X-API-Key-ID`; TTS `POST /api/v1/tts/inference`, `timbre-v3.0`, mp3 64k 24 kHz; voices
Kalpana / Sneha / Sunaina valid. Doc nuance: `detected_language_code` is not returned with `transliterate`. Already handled
(`.get(...) or language`). Gnani wants numbers written as words for TTS; our replies contain "₹840" (pronunciation risk, to test live).
Status: **off by configuration** (`ASR_PROVIDER/TTS_PROVIDER=mock`, no key; frontend `VITE_USE_MOCK_VOICE=true`, `VITE_VOICE_INPUT=browser`).
Credit guard (daily seconds, one-at-a-time lock, TTS cache, usage rows) is covered by pytest with mocks. No live call made.

## Phase 4: env
Variables read by code = exactly those in the two `.env.example` files, plus optional `MOCK_ASR_TEXT`,
`LIVE_TESTS`, `LIVE_DEMO_PASSWORD` (now documented). `.gitignore` covers `.env`, `.env.*` (except examples); verified with
`git check-ignore`. No `.env` was ever committed (full history). Local `Chotu_AI_final/.env` is ignored too.

## Tests (baseline on main, and after fixes)
| Check | Baseline | After fixes |
|---|---|---|
| backend pytest | 116 passed, 4 skipped (live) | 119 passed, 4 skipped |
| frontend lint (eslint) | pass | pass |
| `tsc -b && vite build` | pass (warning: 507 kB chunk) | pass |
| `test:assistant` | 35/35 | not affected |
| `test:shell` | 25/25 | 24/25 then 25/25, 25/25: **flaky** "side-menu aria-current" check (1 in 3) |
| `test:visual` (Landing/Login/Signup × 5 widths + states) | all 0.0000 % | not affected |
| `phase1_checks.sql` | read-only parts PASS; write parts not run (declined) | — |
| Secret scan, full history (sb_secret, sb_publishable, JWT, pg URL with password, gsk_, sk-, AIza, AKIA, private keys, GNANI key) | clean (scanner verified with a positive control) | — |

## Phase 9: `origin/rashmitha-final` review (2 commits on top of `1401efc`)
1. `GET /quick-update` (read-only, shop-scoped, has tests). Problems to fix before merging:
   - Undone sales still count: reversal rows are dropped, but the sales they reverse are not.
   - Day boundaries are UTC; the shop is in IST (+5:30), so "today" starts at 05:30.
   - `period=custom` is accepted but silently means "last 7 days".
   - Partial sales (`payment_mode='partial'`) never reach Cash/UPI totals; the test fixture uses `cash` with a due amount, which the DB forbids.
2. `allow_origin_regex` for **any** localhost port with credentials (commit says "temporary"). Recommend dropping it and using `CORS_ORIGINS`.
3. `_entry_dict` now returns raw `payment_mode` (`udhaar`/`partial`) instead of `credit`. An API contract change; no frontend user today.
4. A stray indentation change in `sales_report`.
`rashmitha-1`: 3 commits not in main (SQLite era): still to be confirmed as ported.
`Chotu_AI_final/`: present locally (untracked, own `.venv` and `.env`), **not integrated** as instructed.
