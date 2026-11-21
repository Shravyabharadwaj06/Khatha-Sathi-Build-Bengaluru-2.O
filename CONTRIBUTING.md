# Contributing to Khatha Sathi

## Branches
- `main` always works. Nobody pushes to it directly; changes arrive through pull requests.
- Make a branch from the latest `main` for each piece of work, named `<your-name>/<what>`, for example `shravya/reports-page` or `rashmitha/reminder-tone`.
- Keep a branch to one topic. Small pull requests get reviewed faster.
- To catch up with `main`, **merge** it into your branch: `git merge origin/main`.
  - Don't rebase or force-push a branch someone else has pulled.
- Delete your branch after its pull request is merged.

## Commits
- Write messages in the present tense that say what changed and why, e.g. `Customers: refuse payment above the due amount`.
- If someone else's idea or code is in the commit, credit them on the last line: `Co-authored-by: Name <email>`.

## Pull requests
1. Push your branch and open a PR into `main`.
2. Describe what changed, how you tested it, and include screenshots for UI changes.
3. CI must pass: frontend lint, build and assistant checks, plus backend pytest.
4. One teammate reviews and approves. The author merges.

## Before you push
```bash
cd backend && python -m pytest -q
cd frontend && npm run lint && npm run build && npm run test:assistant
```
- If you changed the app shell or the pages, also run `npm run test:shell`.
- If you touched Landing, Login, Signup, Terms or Privacy, also run `npm run test:visual`. Those pages must match the Stitch designs exactly.

## Rules that keep the data safe
- **Money** is stored in integer **paise**. Only the UI formats it as ₹.
- **The ledger is append-only.** Never update or delete a ledger row. Undo writes a reversal entry.
- **Balances** change only through bills, payments, reversals or the opening balance entered when a customer is created.
- **Every query** must be scoped by the user's `shop_id`.
- **New API fields go through the contracts.** Update [`docs/DB_CONTRACT.md`](docs/DB_CONTRACT.md) or [`docs/VOICE_CONTRACT.md`](docs/VOICE_CONTRACT.md) in the same PR.
- **Database changes** go in a new file in `supabase/migrations/`. Never edit a migration that has already been applied.
  - Never DROP or TRUNCATE real data without the team's OK.

## Secrets
- **Never commit** `.env`, `.mcp.json`, keys, passwords, `.db` files or screenshots of dashboards. They are already listed in `.gitignore`.
- **Only the backend holds:**
  - the Supabase service-role key
  - the database password
  - `GNANI_API_KEY`

  The browser never sees them and never calls Gnani directly.
- **Ask the team lead** for the real values. Share them through a private channel, never in an issue, PR or chat log.
- **If a secret is ever committed,** tell the team at once so it can be rotated. Deleting the commit is not enough.

## Gnani credits
- Tests and CI use the mock providers.
- Use `ASR_PROVIDER=gnani` only when you mean to.
  - Gnani allows one request at a time.
  - `GNANI_DAILY_LIMIT_SECONDS` caps daily use.
- See [`docs/GNANI_NOTES.md`](docs/GNANI_NOTES.md).
