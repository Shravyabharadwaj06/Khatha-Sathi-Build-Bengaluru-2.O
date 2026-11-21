-- Khatha Sathi core schema.
-- Money is always integer paise (bigint). Every business table has shop_id.
-- Child tables use composite foreign keys (shop_id, <parent>_id) so a row can never point at another shop's data.

-- ---------------------------------------------------------------------------
-- Private helper schema (not exposed through the Supabase Data API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Lower-cased text used for fuzzy search (name + aliases + extra, e.g. locality/category).
create or replace function private.search_text(p_name text, p_aliases text[], p_extra text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(concat_ws(' ', p_name, array_to_string(p_aliases, ' '), p_extra))
$$;

-- The user acting on the database: the Supabase JWT user, or (for the FastAPI backend,
-- which connects as a database role) the value of `set local app.user_id = '<uuid>'`.
create or replace function private.acting_user_id()
returns uuid language sql stable set search_path = '' as $$
  select coalesce(auth.uid(), nullif(current_setting('app.user_id', true), '')::uuid)
$$;

-- ---------------------------------------------------------------------------
-- Shops, profiles, settings
-- ---------------------------------------------------------------------------
create table public.shops (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null unique references auth.users (id) on delete restrict,
  shop_name       text check (shop_name is null or char_length(shop_name) between 1 and 120),
  city            text check (city is null or char_length(city) <= 80),
  business_domain text check (business_domain is null or char_length(business_domain) <= 80),
  address         text check (address is null or char_length(address) <= 300),
  gst_number      text check (gst_number is null or gst_number ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  fssai_number    text check (fssai_number is null or fssai_number ~ '^[0-9]{14}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  shop_id            uuid not null references public.shops (id) on delete restrict,
  owner_name         text not null check (char_length(owner_name) between 1 and 120),
  phone              text not null unique check (phone ~ '^[0-9]{10}$'),
  email              text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  avatar_path        text check (avatar_path is null or char_length(avatar_path) <= 300),
  primary_language   text check (primary_language is null or char_length(primary_language) <= 80),
  secondary_language text check (secondary_language is null or char_length(secondary_language) <= 80),
  consent_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index profiles_email_lower_key on public.profiles (lower(email));
create index profiles_shop_id_idx on public.profiles (shop_id);

create table public.user_settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  spoken_replies   boolean not null default true,
  voice_speed      text not null default 'Normal' check (voice_speed in ('Slow', 'Normal', 'Fast')),
  voice_volume     smallint not null default 80 check (voice_volume between 0 and 100),
  daily_ledger_pdf boolean not null default true,
  low_stock_alert  boolean not null default true,
  payment_reminder boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Products and customers (soft delete with archived_at)
-- ---------------------------------------------------------------------------
create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shops (id) on delete restrict,
  name                 text not null check (char_length(btrim(name)) between 1 and 120),
  aliases              text[] not null default '{}',
  category             text check (category is null or char_length(category) <= 60),
  unit                 text not null default 'pcs' check (char_length(unit) between 1 and 20),
  selling_price_paise  bigint check (selling_price_paise >= 0),   -- null = price not known yet (voice add)
  purchase_price_paise bigint check (purchase_price_paise >= 0),
  stock_qty            numeric(12, 3) not null default 0 check (stock_qty >= 0),
  low_stock_threshold  numeric(12, 3) not null default 5 check (low_stock_threshold >= 0),
  expiry_date          date,
  legacy_ref           text,
  search_text          text generated always as (private.search_text(name, aliases, category)) stored,
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (shop_id, id)
);
create unique index products_shop_name_active_key on public.products (shop_id, lower(name)) where archived_at is null;
create unique index products_shop_legacy_ref_key on public.products (shop_id, legacy_ref) where legacy_ref is not null;
create index products_search_trgm_idx on public.products using gin (search_text extensions.gin_trgm_ops);

create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops (id) on delete restrict,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  aliases      text[] not null default '{}',
  locality     text check (locality is null or char_length(locality) <= 120),
  phone        text check (phone is null or phone ~ '^[0-9]{10}$'),
  whatsapp     text check (whatsapp is null or whatsapp ~ '^[0-9]{10}$'),
  credit_score numeric(6, 1) check (credit_score is null or credit_score >= 0),
  legacy_ref   text,
  search_text  text generated always as (private.search_text(name, aliases, locality)) stored,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (shop_id, id)
);
create unique index customers_shop_legacy_ref_key on public.customers (shop_id, legacy_ref) where legacy_ref is not null;
create index customers_search_trgm_idx on public.customers using gin (search_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Ledger (append-only; rules and triggers are in the next migration)
-- due_delta_paise = how much this entry changes the customer's balance (+ owes more, - owes less).
-- It is filled in by a trigger from type/amount/paid, so the balance is always a plain SUM.
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops (id) on delete restrict,
  customer_id     uuid,
  type            text not null check (type in ('sale', 'payment', 'reversal', 'correction', 'opening_balance')),
  amount_paise    bigint not null check (amount_paise >= 0),
  paid_paise      bigint not null default 0 check (paid_paise >= 0),
  due_delta_paise bigint not null default 0,
  payment_mode    text check (payment_mode in ('cash', 'upi', 'udhaar', 'partial')),
  ref_entry_id    uuid,
  source          text not null default 'manual' check (source in ('voice', 'manual', 'scan', 'import')),
  transcript      text check (transcript is null or char_length(transcript) <= 2000),
  note            text check (note is null or char_length(note) <= 500),
  legacy_ref      text,
  created_by      uuid,   -- auth user id (no FK, so history survives account deletion)
  created_at      timestamptz not null default now(),
  unique (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers (shop_id, id),
  foreign key (shop_id, ref_entry_id) references public.ledger_entries (shop_id, id),
  constraint ledger_ref_required check ((type in ('reversal', 'correction')) = (ref_entry_id is not null)),
  constraint ledger_mode_required check (type not in ('sale', 'payment') or payment_mode is not null),
  constraint ledger_sale_paid check (
    type <> 'sale'
    or (payment_mode = 'udhaar' and paid_paise = 0)
    or (payment_mode = 'partial' and paid_paise > 0 and paid_paise < amount_paise)
    or (payment_mode in ('cash', 'upi') and paid_paise = amount_paise)),
  constraint ledger_walkin_sale_paid check (customer_id is not null or type <> 'sale' or paid_paise = amount_paise),
  constraint ledger_payment_valid check (
    type <> 'payment' or (customer_id is not null and amount_paise > 0 and paid_paise = amount_paise and payment_mode in ('cash', 'upi'))),
  constraint ledger_opening_valid check (type <> 'opening_balance' or (customer_id is not null and paid_paise = 0))
);
create index ledger_entries_shop_customer_created_idx on public.ledger_entries (shop_id, customer_id, created_at);
create index ledger_entries_shop_created_idx on public.ledger_entries (shop_id, created_at);
create index ledger_entries_shop_ref_idx on public.ledger_entries (shop_id, ref_entry_id);
create unique index ledger_entries_one_reversal_key on public.ledger_entries (ref_entry_id) where type = 'reversal';
create unique index ledger_entries_shop_legacy_ref_key on public.ledger_entries (shop_id, legacy_ref) where legacy_ref is not null;

create table public.ledger_items (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null,
  entry_id              uuid not null,
  product_id            uuid,
  product_name_snapshot text not null check (char_length(product_name_snapshot) between 1 and 120),
  qty                   numeric(12, 3) not null check (qty > 0),
  unit                  text not null check (char_length(unit) between 1 and 20),
  unit_price_paise      bigint not null check (unit_price_paise >= 0),
  line_total_paise      bigint not null check (line_total_paise >= 0),
  created_at            timestamptz not null default now(),
  -- round() on numeric rounds half away from zero (backend must use the same rule: Decimal ROUND_HALF_UP).
  constraint ledger_items_line_total check (line_total_paise = round(qty * unit_price_paise)),
  foreign key (shop_id, entry_id) references public.ledger_entries (shop_id, id),
  foreign key (shop_id, product_id) references public.products (shop_id, id)
);
create index ledger_items_shop_entry_idx on public.ledger_items (shop_id, entry_id);
create index ledger_items_shop_product_idx on public.ledger_items (shop_id, product_id, created_at);

create table public.stock_movements (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null,
  product_id uuid not null,
  entry_id   uuid,
  qty_change numeric(12, 3) not null check (qty_change <> 0),
  reason     text not null check (reason in ('opening', 'sale', 'reversal', 'restock', 'adjustment', 'correction', 'import')),
  note       text check (note is null or char_length(note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (shop_id, product_id) references public.products (shop_id, id),
  foreign key (shop_id, entry_id) references public.ledger_entries (shop_id, id)
);
create index stock_movements_shop_product_idx on public.stock_movements (shop_id, product_id, created_at);
create index stock_movements_shop_entry_idx on public.stock_movements (shop_id, entry_id);

-- ---------------------------------------------------------------------------
-- Voice assistant drafts (two-phase: draft -> confirm)
-- ---------------------------------------------------------------------------
create table public.assistant_drafts (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops (id) on delete restrict,
  user_id         uuid not null,
  intent          text not null check (intent in ('CREATE_BILL', 'ADD_ITEM', 'CORRECT_CUSTOMER', 'RECORD_PAYMENT',
                                                  'SEND_REMINDER', 'SEND_BILL', 'ADD_PRODUCT', 'UNDO')),
  action_json     jsonb not null check (jsonb_typeof(action_json) = 'object'),
  transcript      text check (transcript is null or char_length(transcript) <= 2000),
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  expires_at      timestamptz not null default (now() + interval '10 minutes'),
  result_entry_id uuid,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint drafts_confirmed_at check ((status = 'confirmed') = (confirmed_at is not null)),
  foreign key (shop_id, result_entry_id) references public.ledger_entries (shop_id, id)
);
create index assistant_drafts_shop_user_status_idx on public.assistant_drafts (shop_id, user_id, status, expires_at);
create index assistant_drafts_shop_result_idx on public.assistant_drafts (shop_id, result_entry_id);

-- ---------------------------------------------------------------------------
-- Payment reminders (drafted only; never sent automatically)
-- ---------------------------------------------------------------------------
create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null,
  customer_id   uuid not null,
  tone          text not null check (tone in ('soft', 'firm')),
  language      text not null check (language in ('hi', 'kn', 'en')),
  message_text  text not null check (char_length(message_text) between 1 and 1000),
  balance_paise bigint check (balance_paise >= 0),   -- the DB balance quoted in the message
  status        text not null default 'drafted' check (status in ('drafted', 'opened_whatsapp')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (shop_id, customer_id) references public.customers (shop_id, id)
);
create index reminders_shop_customer_idx on public.reminders (shop_id, customer_id, created_at);

-- ---------------------------------------------------------------------------
-- Notebook scan import (photo in Storage, rows reviewed before commit)
-- ---------------------------------------------------------------------------
create table public.notebook_imports (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops (id) on delete restrict,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  ocr_provider text not null check (char_length(ocr_provider) between 1 and 40),
  status       text not null default 'review' check (status in ('processing', 'review', 'committed', 'failed')),
  uploaded_by  uuid,
  committed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (shop_id, id)
);

create table public.notebook_import_rows (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null,
  import_id          uuid not null,
  row_index          integer not null check (row_index >= 0),
  customer_name      text check (customer_name is null or char_length(customer_name) <= 120),
  customer_id        uuid,
  amount_paise       bigint check (amount_paise >= 0),
  raw_text           text check (raw_text is null or char_length(raw_text) <= 500),
  checked            boolean not null default false,
  committed_entry_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (shop_id, import_id, row_index),
  foreign key (shop_id, import_id) references public.notebook_imports (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers (shop_id, id),
  foreign key (shop_id, committed_entry_id) references public.ledger_entries (shop_id, id)
);
create index notebook_import_rows_shop_customer_idx on public.notebook_import_rows (shop_id, customer_id);
create index notebook_import_rows_shop_entry_idx on public.notebook_import_rows (shop_id, committed_entry_id);

-- ---------------------------------------------------------------------------
-- Voice (Gnani) usage log, to watch credit spend
-- ---------------------------------------------------------------------------
create table public.voice_usage (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops (id) on delete restrict,
  user_id       uuid not null,
  endpoint      text not null check (endpoint in ('transcribe', 'command', 'speak', 'realtime')),
  provider      text not null check (char_length(provider) between 1 and 40),
  audio_seconds numeric(8, 2) not null default 0 check (audio_seconds >= 0),
  characters    integer not null default 0 check (characters >= 0),
  success       boolean not null default true,
  created_at    timestamptz not null default now()
);
create index voice_usage_shop_created_idx on public.voice_usage (shop_id, created_at);
create index voice_usage_user_created_idx on public.voice_usage (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Support reports (files live in Storage; only paths here)
-- ---------------------------------------------------------------------------
create sequence public.support_report_ref_seq start 2041;

create table public.support_reports (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops (id) on delete restrict,
  user_id         uuid not null,
  reference       text not null unique default ('CH-' || nextval('public.support_report_ref_seq')),
  categories      text[] not null check (cardinality(categories) between 1 and 8 and array_position(categories, null) is null),
  description     text not null check (char_length(btrim(description)) between 1 and 1000),
  contact_allowed boolean not null default true,
  status          text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (shop_id, id)
);
create index support_reports_shop_user_created_idx on public.support_reports (shop_id, user_id, created_at desc);

create table public.support_report_attachments (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null,
  report_id    uuid not null,
  name         text not null check (char_length(name) between 1 and 255),
  media_type   text not null check (media_type like 'image/%'),
  size_bytes   integer not null check (size_bytes between 1 and 8388608),
  storage_path text not null unique check (char_length(storage_path) <= 300),
  created_at   timestamptz not null default now(),
  foreign key (shop_id, report_id) references public.support_reports (shop_id, id)
);
create index support_report_attachments_shop_report_idx on public.support_report_attachments (shop_id, report_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only; filled by triggers)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid,
  user_id    uuid,
  action     text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  row_id     uuid,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_shop_created_idx on public.audit_log (shop_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger shops_updated_at before update on public.shops for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger user_settings_updated_at before update on public.user_settings for each row execute function private.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function private.set_updated_at();
create trigger customers_updated_at before update on public.customers for each row execute function private.set_updated_at();
create trigger assistant_drafts_updated_at before update on public.assistant_drafts for each row execute function private.set_updated_at();
create trigger reminders_updated_at before update on public.reminders for each row execute function private.set_updated_at();
create trigger notebook_imports_updated_at before update on public.notebook_imports for each row execute function private.set_updated_at();
create trigger notebook_import_rows_updated_at before update on public.notebook_import_rows for each row execute function private.set_updated_at();
create trigger support_reports_updated_at before update on public.support_reports for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges: anon gets nothing; authenticated gets only what the RLS policies allow.
-- (Supabase grants ALL on new public tables by default, so reset first.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, update on public.shops, public.profiles to authenticated;
grant select, insert, update on public.user_settings, public.products, public.customers, public.assistant_drafts,
  public.reminders, public.notebook_imports, public.notebook_import_rows to authenticated;
grant select, insert on public.ledger_entries, public.ledger_items, public.stock_movements,
  public.support_reports, public.support_report_attachments to authenticated;
grant select on public.voice_usage, public.audit_log to authenticated;
grant usage on sequence public.support_report_ref_seq to authenticated;

revoke all on all functions in schema private from public, anon;
grant execute on function private.search_text(text, text[], text), private.acting_user_id() to authenticated, service_role;
