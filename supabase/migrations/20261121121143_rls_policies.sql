-- Row Level Security: a signed-in user (role `authenticated`) can only reach rows of their own shop.
-- `anon` has no table privileges at all. The FastAPI backend connects as a database role that
-- bypasses RLS, so it MUST also filter by the shop it derived from the user's JWT.
-- Auth calls are wrapped as (select ...) so Postgres evaluates them once per query, not once per row.

-- The signed-in user's shop (from their profile). SECURITY INVOKER: it reads `profiles`
-- through that table's own RLS policy (user_id = auth.uid()).
create or replace function private.current_shop_id()
returns uuid language sql stable set search_path = '' as $$
  select p.shop_id from public.profiles p where p.user_id = (select auth.uid())
$$;
revoke all on function private.current_shop_id() from public, anon;
grant execute on function private.current_shop_id() to authenticated, service_role;

alter table public.shops                      enable row level security;
alter table public.profiles                   enable row level security;
alter table public.user_settings              enable row level security;
alter table public.products                   enable row level security;
alter table public.customers                  enable row level security;
alter table public.ledger_entries             enable row level security;
alter table public.ledger_items               enable row level security;
alter table public.stock_movements            enable row level security;
alter table public.assistant_drafts           enable row level security;
alter table public.reminders                  enable row level security;
alter table public.notebook_imports           enable row level security;
alter table public.notebook_import_rows       enable row level security;
alter table public.voice_usage                enable row level security;
alter table public.support_reports            enable row level security;
alter table public.support_report_attachments enable row level security;
alter table public.audit_log                  enable row level security;

-- shops: read/update your own shop (created by the backend at signup)
create policy shops_select on public.shops for select to authenticated
  using (id = (select private.current_shop_id()));
create policy shops_update on public.shops for update to authenticated
  using (id = (select private.current_shop_id()))
  with check (id = (select private.current_shop_id()) and owner_user_id = (select auth.uid()));

-- profiles: read/update only your own profile (shop_id cannot be changed to another shop)
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and shop_id = (select private.current_shop_id()));

-- user_settings: your own row
create policy user_settings_select on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_settings_update on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Shop-scoped tables that can be edited (no DELETE anywhere: archive instead)
create policy products_select on public.products for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy products_insert on public.products for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));
create policy products_update on public.products for update to authenticated
  using (shop_id = (select private.current_shop_id())) with check (shop_id = (select private.current_shop_id()));

create policy customers_select on public.customers for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy customers_insert on public.customers for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));
create policy customers_update on public.customers for update to authenticated
  using (shop_id = (select private.current_shop_id())) with check (shop_id = (select private.current_shop_id()));

create policy reminders_select on public.reminders for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy reminders_insert on public.reminders for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));
create policy reminders_update on public.reminders for update to authenticated
  using (shop_id = (select private.current_shop_id())) with check (shop_id = (select private.current_shop_id()));

create policy notebook_imports_select on public.notebook_imports for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy notebook_imports_insert on public.notebook_imports for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));
create policy notebook_imports_update on public.notebook_imports for update to authenticated
  using (shop_id = (select private.current_shop_id())) with check (shop_id = (select private.current_shop_id()));

create policy notebook_import_rows_select on public.notebook_import_rows for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy notebook_import_rows_insert on public.notebook_import_rows for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));
create policy notebook_import_rows_update on public.notebook_import_rows for update to authenticated
  using (shop_id = (select private.current_shop_id())) with check (shop_id = (select private.current_shop_id()));

-- assistant drafts: your own drafts in your shop
create policy assistant_drafts_select on public.assistant_drafts for select to authenticated
  using (shop_id = (select private.current_shop_id()) and user_id = (select auth.uid()));
create policy assistant_drafts_insert on public.assistant_drafts for insert to authenticated
  with check (shop_id = (select private.current_shop_id()) and user_id = (select auth.uid()));
create policy assistant_drafts_update on public.assistant_drafts for update to authenticated
  using (shop_id = (select private.current_shop_id()) and user_id = (select auth.uid()))
  with check (shop_id = (select private.current_shop_id()) and user_id = (select auth.uid()));

-- Append-only history: read + insert only
create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy ledger_entries_insert on public.ledger_entries for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));

create policy ledger_items_select on public.ledger_items for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy ledger_items_insert on public.ledger_items for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy stock_movements_insert on public.stock_movements for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));

-- Support reports: your own reports in your shop
create policy support_reports_select on public.support_reports for select to authenticated
  using (shop_id = (select private.current_shop_id()) and user_id = (select auth.uid()));
create policy support_reports_insert on public.support_reports for insert to authenticated
  with check (shop_id = (select private.current_shop_id()) and user_id = (select auth.uid()));

create policy support_report_attachments_select on public.support_report_attachments for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy support_report_attachments_insert on public.support_report_attachments for insert to authenticated
  with check (shop_id = (select private.current_shop_id()));

-- Written only by the backend; the shop can read its own rows
create policy voice_usage_select on public.voice_usage for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy audit_log_select on public.audit_log for select to authenticated
  using (shop_id = (select private.current_shop_id()));
