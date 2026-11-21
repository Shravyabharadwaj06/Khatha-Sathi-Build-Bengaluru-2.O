# Khatha Sathi: Database contract (as built, 2026-11-21)

This is what is **live** in the Supabase project. It is checked against the database itself.
- Schema source of truth: `supabase/migrations/` (9 files, all applied).
- Demo data is already present in Supabase; the source branch's seed script is not copied here.
- Checks: `supabase/tests/phase1_checks.sql` (20/20 pass).
- Generated TypeScript types remain on the source branch; API compatibility mappings are documented below.

Connection values are placeholders. Keys and the DB password belong only in `backend/.env`.

---

## 1. How to connect (FastAPI backend)

- **Use the Session pooler, port 5432** (works over IPv4).
  - The direct host `db.<project-ref>.supabase.co` is IPv6-only unless the IPv4 add-on is turned on.
  - Region: ap-northeast-2 (Seoul). For production, the database will be hosted in ap-south-1 (Mumbai) for DPDP data-localisation compliance.
- **Format** (copy the exact host from Dashboard → **Connect** → Session pooler):
  `postgresql+psycopg://postgres.<project-ref>:<PASSWORD>@aws-<N>-ap-northeast-2.pooler.supabase.com:5432/postgres`
- If you ever switch to the Transaction pooler (port 6543), disable prepared statements and use `NullPool`.
- **Login tokens:** Supabase Auth signs them with **ES256**. Verify them with the project's JWKS at `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`, so no JWT secret is needed.
- **The service-role key and the DB password bypass RLS.** They stay only in `backend/.env`: never in the frontend, git or logs.

### Rules the backend must follow
1. **Always filter by shop.**
   - The backend's DB role bypasses RLS, so every query needs `where shop_id = <shop of the logged-in user>`.
   - Get the shop from `profiles.shop_id` for the user id in the verified JWT. Never take `shop_id` from the request body.
2. **Say who is acting.** At the start of each write transaction run `select set_config('app.user_id', '<auth user uuid>', true)`. Triggers then fill `created_by` and `audit_log.user_id`.
3. **Money is integer paise.** Line totals use `round(qty * unit_price_paise)`, rounding half away from zero; in Python use `Decimal(...).quantize(Decimal(1), ROUND_HALF_UP)`. Convert to rupees only in API responses.
4. **The ledger is append-only.**
   - Never UPDATE or DELETE `ledger_entries`, `ledger_items`, `stock_movements` or `audit_log`; the database refuses it.
   - Undo means inserting a `reversal` row.
   - A fix means inserting a `correction` row.
5. **Stock changes only by inserting `stock_movements`.** A trigger updates `products.stock_qty`, and `stock_qty >= 0` is enforced, so overselling fails the whole transaction.
6. **Never store a balance.** Read `customer_balances` or call `explain_customer_balance`.
7. **Soft delete products and customers** by setting `archived_at`.

---

## 2. Demo data

Demo account credentials are intentionally omitted from this tracked contract. Use the Supabase dashboard or a private credential channel for any demo login details.

---

## 3. Schemas

| Schema | What | Exposed by the Data API? |
|---|---|---|
| `public` | All app tables, the balance view, 4 functions | yes (and RLS protects every table) |
| `private` | Helper and trigger functions | no |
| `legacy` | Rashmitha's 4 prototype tables, **moved unchanged**, kept until the owner approves removal | no; deny-all policies, no grants |

Extensions: `pg_trgm` (fuzzy search), `pgcrypto` and `uuid-ossp`, all in `extensions`.

---

## 4. Tables (`public`)

Notes that apply to every table:
- Every id is a `uuid` (default `gen_random_uuid()`).
- `created_at` / `updated_at` are `timestamptz not null default now()`, and `updated_at` is kept current by a trigger.
- "→" marks a foreign key.
- **Composite FK** `(shop_id, x_id) → parent(shop_id, id)` means a row can never point at another shop's data.

### shops
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK |
| owner_user_id | uuid | no | UNIQUE, → auth.users(id) ON DELETE RESTRICT |
| shop_name | text | yes | 1–120 chars |
| city | text | yes | ≤ 80 |
| business_domain | text | yes | ≤ 80 |
| address | text | yes | ≤ 300 |
| gst_number | text | yes | `^[0-9]{2}[A-Z0-9]{13}$` |
| fssai_number | text | yes | `^[0-9]{14}$` |
| created_at, updated_at | timestamptz | no | now() |

### profiles (one per auth user)
| column | type | null | default / constraint |
|---|---|---|---|
| user_id | uuid | no | PK, → auth.users(id) ON DELETE CASCADE |
| shop_id | uuid | no | → shops(id) RESTRICT; index |
| owner_name | text | no | 1–120 |
| phone | text | no | UNIQUE, `^[0-9]{10}$` |
| email | text | no | email format; UNIQUE on lower(email) |
| avatar_path | text | yes | Storage path in `avatars` (≤ 300) |
| primary_language, secondary_language | text | yes | ≤ 80 (free text, as the Profile page sends it) |
| consent_at | timestamptz | yes | DPDP consent time |
| created_at, updated_at | timestamptz | no | now() |

### user_settings (one per auth user; matches `ProfileInput`)
| column | type | null | default / constraint |
|---|---|---|---|
| user_id | uuid | no | PK, → auth.users(id) CASCADE |
| spoken_replies | boolean | no | true |
| voice_speed | text | no | 'Normal'; one of Slow / Normal / Fast |
| voice_volume | smallint | no | 80; 0–100 |
| daily_ledger_pdf, low_stock_alert, payment_reminder | boolean | no | true |
| created_at, updated_at | timestamptz | no | now() |

### products
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK; UNIQUE (shop_id, id) |
| shop_id | uuid | no | → shops(id) RESTRICT |
| name | text | no | 1–120; UNIQUE (shop_id, lower(name)) among non-archived |
| aliases | text[] | no | '{}' (e.g. namak, uppu) |
| category | text | yes | ≤ 60 |
| unit | text | no | 'pcs'; 1–20 |
| selling_price_paise | bigint | yes | ≥ 0 (null = price not known yet) |
| purchase_price_paise | bigint | yes | ≥ 0 |
| stock_qty | numeric(12,3) | no | 0; **≥ 0**; maintained by stock_movements |
| low_stock_threshold | numeric(12,3) | no | 5; ≥ 0 |
| expiry_date | date | yes | |
| legacy_ref | text | yes | old prototype id; UNIQUE per shop |
| search_text | text | (generated) | lower(name + aliases + category); GIN trigram index |
| archived_at | timestamptz | yes | soft delete |
| created_at, updated_at | timestamptz | no | now() |

### customers
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK; UNIQUE (shop_id, id) |
| shop_id | uuid | no | → shops(id) RESTRICT |
| name | text | no | 1–120 (not unique: two Ravis allowed) |
| aliases | text[] | no | '{}' |
| locality | text | yes | ≤ 120 |
| phone, whatsapp | text | yes | `^[0-9]{10}$` |
| credit_score | numeric(6,1) | yes | ≥ 0 (kept because the Customers page edits it) |
| legacy_ref | text | yes | UNIQUE per shop |
| search_text | text | (generated) | lower(name + aliases + locality); GIN trigram index |
| archived_at | timestamptz | yes | soft delete |
| created_at, updated_at | timestamptz | no | now() |

### ledger_entries (append-only)
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK; UNIQUE (shop_id, id) |
| shop_id | uuid | no | → shops(id) RESTRICT |
| customer_id | uuid | yes | (shop_id, customer_id) → customers; null = walk-in |
| type | text | no | sale / payment / reversal / correction / opening_balance |
| amount_paise | bigint | no | ≥ 0 |
| paid_paise | bigint | no | 0; ≥ 0 |
| due_delta_paise | bigint | no | **set by trigger**: change to the customer's balance (+ owes more) |
| payment_mode | text | yes | cash / upi / udhaar / partial |
| ref_entry_id | uuid | yes | (shop_id, ref_entry_id) → ledger_entries; required for reversal and correction |
| source | text | no | 'manual'; voice / manual / scan / import |
| transcript | text | yes | ≤ 2000 (voice text only, never audio) |
| note | text | yes | ≤ 500 |
| legacy_ref | text | yes | UNIQUE per shop |
| created_by | uuid | yes | auth user (filled by trigger; no FK so history survives) |
| created_at | timestamptz | no | now() |

CHECK rules:
- A `sale` paid in `udhaar` has paid = 0.
- A `partial` sale has 0 < paid < amount.
- A `cash` or `upi` sale has paid = amount.
- A walk-in sale (no customer) must be fully paid.
- A `payment` needs a customer, amount > 0, paid = amount and mode cash or upi.
- An `opening_balance` needs a customer and paid = 0.
- Only one reversal per entry (unique index).

How `due_delta_paise` is set:
- **sale:** amount − paid (0 for walk-ins)
- **payment:** −amount
- **opening_balance:** +amount
- **reversal:** the trigger copies the original entry and negates its delta; a reversal cannot itself be reversed
- **correction:** the caller supplies the signed delta

### ledger_items (append-only; only for `sale` entries)
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK |
| shop_id | uuid | no | |
| entry_id | uuid | no | (shop_id, entry_id) → ledger_entries |
| product_id | uuid | yes | (shop_id, product_id) → products |
| product_name_snapshot | text | no | 1–120 |
| qty | numeric(12,3) | no | > 0 |
| unit | text | no | 1–20 |
| unit_price_paise | bigint | no | ≥ 0 |
| line_total_paise | bigint | no | **= round(qty × unit_price_paise)** |
| created_at | timestamptz | no | now() |

At commit, a deferred trigger checks that a sale's `amount_paise` equals the sum of its items.

### stock_movements (append-only)
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK |
| shop_id | uuid | no | |
| product_id | uuid | no | (shop_id, product_id) → products |
| entry_id | uuid | yes | (shop_id, entry_id) → ledger_entries |
| qty_change | numeric(12,3) | no | ≠ 0 (negative = out) |
| reason | text | no | opening / sale / reversal / restock / adjustment / correction / import |
| note | text | yes | ≤ 300 |
| created_by | uuid | yes | filled by trigger |
| created_at | timestamptz | no | now() |

### assistant_drafts (voice draft → confirm)
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK |
| shop_id | uuid | no | → shops(id) |
| user_id | uuid | no | auth user |
| intent | text | no | CREATE_BILL / ADD_ITEM / CORRECT_CUSTOMER / RECORD_PAYMENT / SEND_REMINDER / SEND_BILL / ADD_PRODUCT / UNDO |
| action_json | jsonb | no | must be a JSON object |
| transcript | text | yes | ≤ 2000 |
| status | text | no | 'pending'; pending / confirmed / cancelled / expired |
| expires_at | timestamptz | no | now() + 10 minutes |
| result_entry_id | uuid | yes | (shop_id, result_entry_id) → ledger_entries |
| confirmed_at | timestamptz | yes | set exactly when status = confirmed |
| created_at, updated_at | timestamptz | no | now() |

### reminders (drafted only; never sent automatically)
| column | type | null | default / constraint |
|---|---|---|---|
| id | uuid | no | PK |
| shop_id, customer_id | uuid | no | (shop_id, customer_id) → customers |
| tone | text | no | soft / firm |
| language | text | no | hi / kn / en |
| message_text | text | no | 1–1000 |
| balance_paise | bigint | yes | ≥ 0 (the DB balance quoted in the message) |
| status | text | no | 'drafted'; drafted / opened_whatsapp |
| created_by | uuid | yes | |
| created_at, updated_at | timestamptz | no | now() |

### notebook_imports / notebook_import_rows (scan → review → commit)
- **notebook_imports:**
  - `id` PK; `shop_id` → shops; `storage_path` (UNIQUE, ≤ 300, in `khata-scans`); `ocr_provider` (1–40)
  - `status`: review (default) / processing / committed / failed
  - `uploaded_by`, `committed_at`, `created_at`, `updated_at`
  - UNIQUE (shop_id, id)
- **notebook_import_rows:**
  - `id` PK; `shop_id`; (shop_id, import_id) → notebook_imports; `row_index` ≥ 0, UNIQUE per import
  - `customer_name` ≤ 120; (shop_id, customer_id) → customers (nullable); `amount_paise` ≥ 0
  - `raw_text` ≤ 500; `checked` (default false); (shop_id, committed_entry_id) → ledger_entries (nullable)
  - `created_at`, `updated_at`

### voice_usage (Gnani spend log)
- `id`, `shop_id` → shops, `user_id`
- `endpoint`: transcribe / command / speak / realtime
- `provider` (1–40), `audio_seconds` numeric(8,2) ≥ 0, `characters` int ≥ 0, `success` (default true), `created_at`

### support_reports / support_report_attachments (files in Storage, not in the DB)
- **support_reports:**
  - `id`, `shop_id` → shops, `user_id`
  - `reference`: UNIQUE, default `'CH-' || nextval(support_report_ref_seq)`, starting at CH-2041
  - `categories` text[] (1–8, no nulls); `description` (1–1000 after trim); `contact_allowed` (default true)
  - `status`: open (default) / in_progress / resolved / closed
  - `created_at`, `updated_at`
- **support_report_attachments:**
  - `id`, `shop_id`, (shop_id, report_id) → support_reports
  - `name` 1–255; `media_type` like 'image/%'; `size_bytes` 1–8 MB
  - `storage_path` UNIQUE (in `support-attachments`); `created_at`

### audit_log (append-only; filled by triggers)
- `id`, `shop_id`, `user_id`, `action` (insert / update / delete), `table_name`, `row_id`, `before` jsonb, `after` jsonb, `created_at`
- Audited tables:
  - all inserts, updates and deletes on shops, profiles, user_settings, products, customers, assistant_drafts, reminders, notebook_imports, notebook_import_rows, support_reports, support_report_attachments
  - inserts on ledger_entries, ledger_items, stock_movements

### Indexes (besides PK / UNIQUE)
- **profiles:** (shop_id)
- **products and customers:** GIN trigram on search_text; UNIQUE (shop_id, legacy_ref)
- **products only:** UNIQUE (shop_id, lower(name)) among non-archived
- **ledger_entries:**
  - (shop_id, customer_id, created_at)
  - (shop_id, created_at)
  - (shop_id, ref_entry_id)
  - UNIQUE (ref_entry_id) where type = 'reversal'
  - UNIQUE (shop_id, legacy_ref)
- **ledger_items:** (shop_id, entry_id) and (shop_id, product_id, created_at)
- **stock_movements:** (shop_id, product_id, created_at) and (shop_id, entry_id)
- **assistant_drafts:** (shop_id, user_id, status, expires_at) and (shop_id, result_entry_id)
- **reminders:** (shop_id, customer_id, created_at)
- **notebook_import_rows:** (shop_id, customer_id) and (shop_id, committed_entry_id)
- **voice_usage:** (shop_id, created_at) and (user_id, created_at)
- **support_reports:** (shop_id, user_id, created_at desc)
- **support_report_attachments:** (shop_id, report_id)
- **audit_log:** (shop_id, created_at)

---

## 5. View and functions (`public`, all SECURITY INVOKER so RLS applies; `search_path` pinned)

| Name | Returns |
|---|---|
| view `customer_balances` | shop_id, customer_id, name, locality, phone, archived_at, **balance_paise** (= SUM of due_delta_paise), entry_count, last_entry_at |
| `explain_customer_balance(p_shop_id, p_customer_id)` | The entries that make up the balance, oldest first: entry_id, created_at, type, payment_mode, amount_paise, paid_paise, due_delta_paise, **running_balance_paise**, ref_entry_id, items_summary, note. The last running balance equals the balance. |
| `customers_with_old_dues(p_shop_id, p_min_days default 30)` | Customers whose oldest **unpaid** amount is at least N days old (payments clear the oldest dues first; reversed pairs are ignored): customer_id, name, locality, phone, whatsapp, balance_paise, oldest_unpaid_at, days_overdue |
| `search_customers(p_shop_id, p_query, p_limit default 10)` | Fuzzy match on name, aliases and locality: customer_id, name, locality, phone, score |
| `search_products(p_shop_id, p_query, p_limit default 10)` | Fuzzy match on name, aliases and category: product_id, name, unit, selling_price_paise, stock_qty, score |

`anon` cannot call any of them; `authenticated` and `service_role` can.

**Private helpers:**
- `private.current_shop_id()`: the signed-in user's shop
- `private.acting_user_id()`: `auth.uid()` or `app.user_id`
- `private.search_text()`
- trigger functions: entry before-insert, item checks, stock update, append-only block, audit, updated_at

---

## 6. Row Level Security

RLS is **ON for every table**. `anon` has no table privileges. Each policy below is `TO authenticated`, and "own shop" means `shop_id = private.current_shop_id()`.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| shops | own shop | – (backend creates it) | own shop, owner only | – |
| profiles | own row | – (backend) | own row, cannot change shop | – |
| user_settings | own row | own row | own row | – |
| products, customers, reminders, notebook_imports, notebook_import_rows | own shop | own shop | own shop | – (archive instead) |
| assistant_drafts | own shop + own user | same | same | – |
| ledger_entries, ledger_items, stock_movements | own shop | own shop | – (append-only) | – |
| support_reports | own shop + own user | same | – | – |
| support_report_attachments | own shop | own shop | – | – |
| voice_usage, audit_log | own shop | – (backend / triggers) | – | – |
| legacy.* (4 tables) | policy `legacy_no_access`: USING (false) | denied | denied | denied |

---

## 7. Storage buckets (all **private**; files are served through signed URLs)

| Bucket | Max size | Allowed types | Path rule |
|---|---|---|---|
| `khata-scans` | 10 MB | jpeg, png, webp, heic, heif | `<shop_id>/...` |
| `support-attachments` | 8 MB | jpeg, png, webp, gif, heic, heif | `<shop_id>/<report_id>/<file>` |
| `avatars` | 2 MB | jpeg, png, webp | `<shop_id>/<user_id>.<ext>` |

**Policies on `storage.objects`:**
- A signed-in user can read and upload only where the first folder is their own shop id.
- Only their own avatar (`<user_id>.<ext>`) can be updated or deleted.

---

## 8. Legacy data (Rashmitha's prototype)

- The 4 tables were moved, **unchanged**, to `legacy` (30 products, 20 customers, 40 transactions, 80 items).
- Their open anon policy was changed to deny everyone.
- The data was **copied** into "Rashmitha test shop":
  - rupees became paise
  - credit_sale → sale / udhaar, cash_sale → sale / cash, payment → payment (cash / upi)
  - current stock became one `import` stock movement per product
  - placeholder phone numbers (`TEST-…`) became empty
- **Check:** the copied balances total **₹5,903.63**, the same as the old stored total, with 0 per-customer mismatches.
- The legacy tables stay until the owner approves removing them.

---

## 9. Checks and advisors

- `supabase/tests/phase1_checks.sql`: **20/20 PASS**. It covers:
  - Ramesh is ₹840, and his explained entries add up to ₹840
  - a fuzzy search for "ravi" finds both Ravis
  - 5 customers have dues older than 30 days
  - UPDATE and DELETE on the ledger are blocked
  - a reversal works, and a second reversal of the same entry is rejected
  - a sale whose items don't match its total is rejected
  - RLS separates the two shops, and anon is denied
  - the legacy total is ₹5,903.63
  - the buckets are private
  - low stock is correct
- **Security advisor:** 1 WARN, "Leaked password protection disabled". That is an Auth dashboard setting (Authentication → Providers/Policies) and can't be changed through SQL.
- **Performance advisor:** INFO "unused index" only. That is expected on a new database with no traffic; the indexes back the foreign keys and the planned queries. There are no warnings for unindexed foreign keys, slow RLS or duplicate policies.

---

## 10. Short answers for the backend builder (Q1–Q8)

- **Q1. Connection:** Session pooler, port 5432 (format in section 1).
- **Q2. Schema:** sections 4–5. All of it is LIVE; models.py (SQLite) is replaced by this schema.
- **Q3. Auth:** Supabase Auth (email + password). The backend verifies ES256 login tokens via JWKS. Custom SHA-256 auth is retired.
- **Q4.** Not provided.
- **Q5. Attachments:** the private bucket `support-attachments`; Postgres stores only the path.
- **Q6. RLS:** section 6. The backend must still scope every query by shop, because the service role bypasses RLS.
- **Q7. Records:** the legacy data in the teammate's Supabase migration was copied and verified (section 8). This clone also contains `backend/khatha.db`; it remains untouched, and its records have not been compared with or migrated to Supabase.
- **Q8. Approved:** the schema is built. Backend code (Phase 2) can start.
