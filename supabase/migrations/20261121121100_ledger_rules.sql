-- Ledger rules, enforced in the database so no client (backend bug, direct API call, SQL editor
-- session without care) can break them.

-- 1) Fill in due_delta_paise and created_by; reversals copy the original entry.
create or replace function private.ledger_entry_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  r public.ledger_entries%rowtype;
begin
  if new.type = 'sale' then
    new.due_delta_paise := case when new.customer_id is null then 0 else new.amount_paise - new.paid_paise end;
  elsif new.type = 'payment' then
    new.due_delta_paise := -new.amount_paise;
  elsif new.type = 'opening_balance' then
    new.due_delta_paise := new.amount_paise;
  else
    select * into r from public.ledger_entries e where e.id = new.ref_entry_id and e.shop_id = new.shop_id;
    if not found then
      raise exception 'ref_entry_id % does not exist in this shop', new.ref_entry_id using errcode = '23503';
    end if;
    if new.type = 'reversal' then
      if r.type = 'reversal' then
        raise exception 'a reversal cannot itself be reversed' using errcode = '23514';
      end if;
      -- A reversal cancels the original exactly.
      new.customer_id     := r.customer_id;
      new.amount_paise    := r.amount_paise;
      new.paid_paise      := r.paid_paise;
      new.payment_mode    := r.payment_mode;
      new.due_delta_paise := -r.due_delta_paise;
    else
      -- correction: the caller supplies the signed due_delta_paise (e.g. +5000 = customer owes Rs 50 more).
      if new.customer_id is null then
        new.customer_id := r.customer_id;
      end if;
      if new.customer_id is null and new.due_delta_paise <> 0 then
        raise exception 'a correction that changes a balance needs a customer' using errcode = '23514';
      end if;
    end if;
  end if;
  new.created_by := coalesce(new.created_by, private.acting_user_id());
  return new;
end $$;

create trigger ledger_entries_before_insert
  before insert on public.ledger_entries
  for each row execute function private.ledger_entry_before_insert();

-- 2) Items only belong to sales; created_by is not stored on items (it is on the entry).
create or replace function private.ledger_item_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_type text;
begin
  select e.type into v_type from public.ledger_entries e where e.id = new.entry_id and e.shop_id = new.shop_id;
  if v_type is distinct from 'sale' then
    raise exception 'ledger items can only be added to a sale entry (entry % is %)', new.entry_id, coalesce(v_type, 'missing')
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger ledger_items_before_insert
  before insert on public.ledger_items
  for each row execute function private.ledger_item_before_insert();

-- 3) At COMMIT: a sale that has items must have amount_paise = sum(line_total_paise).
create or replace function private.ledger_items_total_check()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_amount bigint;
  v_sum    bigint;
begin
  select e.amount_paise into v_amount from public.ledger_entries e where e.id = new.entry_id and e.shop_id = new.shop_id;
  select coalesce(sum(i.line_total_paise), 0) into v_sum
    from public.ledger_items i where i.shop_id = new.shop_id and i.entry_id = new.entry_id;
  if v_sum <> v_amount then
    raise exception 'sale % total is % paise but its items add up to % paise', new.entry_id, v_amount, v_sum
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger ledger_items_total_matches
  after insert on public.ledger_items
  deferrable initially deferred
  for each row execute function private.ledger_items_total_check();

-- 4) Stock: products.stock_qty is kept in step with stock_movements (stock_qty >= 0 is a CHECK,
--    so selling more than is in stock fails the whole transaction).
create or replace function private.stock_movement_after_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.products p
     set stock_qty = p.stock_qty + new.qty_change
   where p.id = new.product_id and p.shop_id = new.shop_id;
  return null;
end $$;

create or replace function private.stock_movement_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, private.acting_user_id());
  return new;
end $$;

create trigger stock_movements_before_insert
  before insert on public.stock_movements
  for each row execute function private.stock_movement_before_insert();

create trigger stock_movements_after_insert
  after insert on public.stock_movements
  for each row execute function private.stock_movement_after_insert();

-- 5) Append-only: block UPDATE, DELETE and TRUNCATE on the money/stock history and the audit log.
--    Undo = insert a 'reversal' row; fix = insert a 'correction' row (both point to the original).
create or replace function private.block_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: % is not allowed. Add a reversal or correction entry instead.',
    tg_table_name, lower(tg_op) using errcode = '42501';
end $$;

create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function private.block_change();
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries
  for each statement execute function private.block_change();
create trigger ledger_items_append_only before update or delete on public.ledger_items
  for each row execute function private.block_change();
create trigger ledger_items_no_truncate before truncate on public.ledger_items
  for each statement execute function private.block_change();
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.block_change();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function private.block_change();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.block_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.block_change();

-- 6) Audit log: every insert/update/delete on business tables is recorded with who and when.
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  insert into public.audit_log (shop_id, user_id, action, table_name, row_id, before, after)
  values (
    case when tg_table_name = 'shops' then (v_row ->> 'id')::uuid else (v_row ->> 'shop_id')::uuid end,
    private.acting_user_id(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id')::uuid,
    v_old,
    v_new);
  return null;
end $$;

create trigger audit_shops after insert or update or delete on public.shops for each row execute function private.audit_row_change();
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function private.audit_row_change();
create trigger audit_user_settings after insert or update or delete on public.user_settings for each row execute function private.audit_row_change();
create trigger audit_products after insert or update or delete on public.products for each row execute function private.audit_row_change();
create trigger audit_customers after insert or update or delete on public.customers for each row execute function private.audit_row_change();
create trigger audit_ledger_entries after insert on public.ledger_entries for each row execute function private.audit_row_change();
create trigger audit_ledger_items after insert on public.ledger_items for each row execute function private.audit_row_change();
create trigger audit_stock_movements after insert on public.stock_movements for each row execute function private.audit_row_change();
create trigger audit_assistant_drafts after insert or update or delete on public.assistant_drafts for each row execute function private.audit_row_change();
create trigger audit_reminders after insert or update or delete on public.reminders for each row execute function private.audit_row_change();
create trigger audit_notebook_imports after insert or update or delete on public.notebook_imports for each row execute function private.audit_row_change();
create trigger audit_notebook_import_rows after insert or update or delete on public.notebook_import_rows for each row execute function private.audit_row_change();
create trigger audit_support_reports after insert or update or delete on public.support_reports for each row execute function private.audit_row_change();
create trigger audit_support_report_attachments after insert or update or delete on public.support_report_attachments for each row execute function private.audit_row_change();

revoke all on function private.ledger_entry_before_insert(), private.ledger_item_before_insert(),
  private.ledger_items_total_check(), private.stock_movement_after_insert(), private.stock_movement_before_insert(),
  private.block_change(), private.audit_row_change() from public, anon, authenticated;
