-- Move Rashmitha's 4 prototype tables, unchanged (no rows touched), out of `public`
-- into a `legacy` schema. `legacy` is not exposed by the Supabase Data API.
-- Keep these tables until the owner approves removing them.
create schema if not exists legacy;
comment on schema legacy is 'Original prototype tables, moved unchanged from public on 2026-11-21. Keep until the owner approves removal.';
revoke all on schema legacy from public, anon, authenticated;
alter table public.products          set schema legacy;
alter table public.customers         set schema legacy;
alter table public.transactions      set schema legacy;
alter table public.transaction_items set schema legacy;
revoke all on all tables in schema legacy from anon, authenticated;
