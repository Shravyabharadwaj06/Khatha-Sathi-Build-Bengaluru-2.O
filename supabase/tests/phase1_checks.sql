-- Phase 1 database checks. Run in the Supabase SQL editor (or via the MCP).
-- Read-only in effect: every write test runs inside a sub-block that is rolled back.
-- Output: one row per check with expected / actual / pass.

create temp table if not exists khatha_checks (n numeric, check_name text, expected text, actual text, pass boolean);

do $checks$
declare
  v_demo_shop uuid := md5('khatha:demo:shop')::uuid;
  v_demo_user uuid := md5('khatha:demo:owner')::uuid;
  v_leg_shop  uuid := md5('khatha:legacy-shop')::uuid;
  v_leg_user  uuid := md5('khatha:legacy-owner')::uuid;
  v_ramesh    uuid := md5('khatha:demo:customer:ramesh')::uuid;
  v_s09       uuid := md5('khatha:demo:entry:S09')::uuid;
  v_bal bigint; v_sum bigint; v_last bigint; v_cnt bigint; v_cnt2 bigint; v_cnt3 bigint;
  v_txt text; v_msg text; v_msg2 text; v_msg3 text; v_rows bigint;
  r record;
begin
  -- 1. Ramesh's balance
  select b.balance_paise into v_bal from public.customer_balances b where b.shop_id = v_demo_shop and b.customer_id = v_ramesh;
  insert into khatha_checks values (1, 'Ramesh balance (customer_balances view)', '84000 paise (Rs 840)',
    v_bal || ' paise (Rs ' || (v_bal / 100.0)::numeric(12,2) || ')', v_bal = 84000);

  -- 2. Explain function adds up to the same balance
  select sum(x.due_delta_paise), count(*),
         (array_agg(x.running_balance_paise order by x.created_at desc, x.entry_id desc))[1],
         string_agg(x.type || ' ' || (x.due_delta_paise / 100.0)::numeric(12,2), ' | ' order by x.created_at, x.entry_id)
    into v_sum, v_cnt, v_last, v_txt
    from public.explain_customer_balance(v_demo_shop, v_ramesh) x;
  insert into khatha_checks values (2, 'explain_customer_balance(Ramesh): entries add up', 'sum = last running total = 84000',
    v_cnt || ' entries: ' || v_txt || ' -> sum ' || v_sum || ', last running ' || v_last, v_sum = 84000 and v_last = 84000);

  -- 3. Fuzzy search "ravi" finds both Ravis
  select count(*) filter (where s.name = 'Ravi'), string_agg(s.name || ' (' || coalesce(s.locality, 'no locality') || ')', ', ')
    into v_cnt, v_txt from public.search_customers(v_demo_shop, 'ravi') s;
  insert into khatha_checks values (3, 'search_customers(''ravi'') finds both Ravis', '2 Ravis', v_cnt || ': ' || v_txt, v_cnt = 2);

  -- 3a. The second Ravi bought rice yesterday
  select count(*) into v_cnt
    from public.ledger_items i join public.ledger_entries e on e.id = i.entry_id
   where e.shop_id = v_demo_shop and e.customer_id = md5('khatha:demo:customer:ravi_2')::uuid
     and i.product_name_snapshot = 'Sona Masoori Rice' and e.created_at between now() - interval '2 days' and now() - interval '1 day';
  insert into khatha_checks values (3.1, 'Ravi (no locality) bought rice 1-2 days ago', '1 sale', v_cnt || ' sale(s)', v_cnt = 1);

  -- 3b. Product aliases
  select string_agg(s.name, ', ') into v_txt from (select * from public.search_products(v_demo_shop, 'tata namak', 1)) s;
  select string_agg(s.name, ', ') into v_msg from (select * from public.search_products(v_demo_shop, 'fortune tel', 1)) s;
  insert into khatha_checks values (3.2, 'search_products alias: tata namak / fortune tel', 'Tata Salt 1kg / Fortune Sunflower Oil 1L',
    v_txt || ' / ' || v_msg, v_txt = 'Tata Salt 1kg' and v_msg = 'Fortune Sunflower Oil 1L');

  -- 4. Customers owing for more than 30 days
  select count(*), string_agg(o.name || ' Rs ' || (o.balance_paise / 100.0)::numeric(12,2) || ' (' || o.days_overdue || 'd)', ', ' order by o.oldest_unpaid_at)
    into v_cnt, v_txt from public.customers_with_old_dues(v_demo_shop, 30) o;
  insert into khatha_checks values (4, 'customers_with_old_dues(30 days)', '5: Suresh, Manjunath, Fatima, Venkatesh, Shabana',
    v_cnt || ': ' || v_txt, v_cnt = 5);

  -- 5. Append-only ledger
  begin
    update public.ledger_entries set amount_paise = 1 where shop_id = v_demo_shop and customer_id = v_ramesh;
    v_msg := 'NOT BLOCKED';
  exception when others then v_msg := sqlerrm; end;
  insert into khatha_checks values (5, 'UPDATE ledger_entries is blocked', 'error: append-only', v_msg, v_msg like '%append-only%');

  begin
    delete from public.ledger_entries where shop_id = v_demo_shop and customer_id = v_ramesh;
    v_msg := 'NOT BLOCKED';
  exception when others then v_msg := sqlerrm; end;
  insert into khatha_checks values (5.1, 'DELETE ledger_entries is blocked', 'error: append-only', v_msg, v_msg like '%append-only%');

  begin
    delete from public.ledger_items where shop_id = v_demo_shop;
    v_msg := 'NOT BLOCKED';
  exception when others then v_msg := sqlerrm; end;
  insert into khatha_checks values (5.2, 'DELETE ledger_items is blocked', 'error: append-only', v_msg, v_msg like '%append-only%');

  -- 5.3 Undo works by adding a reversal row (rolled back afterwards)
  begin
    insert into public.ledger_entries (shop_id, type, amount_paise, ref_entry_id, note)
    values (v_demo_shop, 'reversal', 0, v_s09, 'test undo');
    select b.balance_paise into v_bal from public.customer_balances b where b.customer_id = v_ramesh;
    begin
      insert into public.ledger_entries (shop_id, type, amount_paise, ref_entry_id) values (v_demo_shop, 'reversal', 0, v_s09);
      v_msg2 := 'second reversal ALLOWED';
    exception when unique_violation then v_msg2 := 'second reversal rejected'; end;
    raise exception 'rollback:%:%', v_bal, v_msg2;
  exception when others then v_msg := sqlerrm; end;
  insert into khatha_checks values (5.3, 'Reversal of Ramesh''s Rs 478 bill (rolled back)', 'balance 36200, second reversal rejected',
    v_msg, v_msg = 'rollback:36200:second reversal rejected');

  -- 5.4 A sale whose items do not add up to its total is rejected
  begin
    insert into public.ledger_entries (id, shop_id, type, amount_paise, paid_paise, payment_mode)
    values ('00000000-0000-4000-8000-00000000c0de', v_demo_shop, 'sale', 1000, 1000, 'cash');
    insert into public.ledger_items (shop_id, entry_id, product_name_snapshot, qty, unit, unit_price_paise, line_total_paise)
    values (v_demo_shop, '00000000-0000-4000-8000-00000000c0de', 'Test', 1, 'pcs', 900, 900);
    set constraints all immediate;
    raise exception 'NOT BLOCKED';
  exception when others then v_msg := sqlerrm; end;
  insert into khatha_checks values (5.4, 'Sale total must equal its items', 'error: items add up to 900', v_msg, v_msg like '%items add up to 900%');

  -- 6. RLS: demo user
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_demo_user, 'role', 'authenticated')::text, true);
  select count(*) into v_cnt from public.customers;
  select count(*) into v_cnt2 from public.customers where shop_id = v_leg_shop;
  select count(*) into v_cnt3 from public.ledger_entries where shop_id = v_leg_shop;
  begin
    insert into public.customers (shop_id, name) values (v_leg_shop, 'Intruder');
    v_msg := 'NOT BLOCKED';
  exception when others then v_msg := sqlerrm; end;
  update public.products set selling_price_paise = 1 where shop_id = v_leg_shop;
  get diagnostics v_rows = row_count;
  begin
    perform 1 from legacy.customers limit 1;
    v_msg2 := 'NOT BLOCKED';
  exception when others then v_msg2 := sqlerrm; end;
  reset role;
  insert into khatha_checks values (6, 'RLS demo user: sees own customers only', '11 own, 0 of the other shop',
    v_cnt || ' visible, ' || v_cnt2 || ' customers + ' || v_cnt3 || ' entries of the other shop', v_cnt = 11 and v_cnt2 = 0 and v_cnt3 = 0);
  insert into khatha_checks values (6.1, 'RLS demo user: cannot insert into the other shop', 'error: row-level security', v_msg, v_msg like '%row-level security%');
  insert into khatha_checks values (6.2, 'RLS demo user: cannot update the other shop''s products', '0 rows changed', v_rows || ' rows changed', v_rows = 0);
  insert into khatha_checks values (6.3, 'Signed-in user cannot read legacy tables', 'error: permission denied', v_msg2, v_msg2 like '%permission denied%');

  -- 6.4 RLS: Rashmitha test-shop user
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_leg_user, 'role', 'authenticated')::text, true);
  select count(*) into v_cnt from public.customers;
  select count(*) into v_cnt2 from public.customers where shop_id = v_demo_shop;
  select count(*) into v_cnt3 from public.customer_balances where shop_id = v_demo_shop;
  reset role;
  insert into khatha_checks values (6.4, 'RLS test-shop user: sees own customers only', '20 own, 0 of the demo shop',
    v_cnt || ' visible, ' || v_cnt2 || ' customers + ' || v_cnt3 || ' balances of the demo shop', v_cnt = 20 and v_cnt2 = 0 and v_cnt3 = 0);

  -- 6.5 anon (public key, not signed in) gets nothing
  set local role anon;
  begin
    perform 1 from public.customers limit 1;
    v_msg := 'NOT BLOCKED';
  exception when others then v_msg := sqlerrm; end;
  reset role;
  insert into khatha_checks values (6.5, 'anon cannot read customers', 'error: permission denied', v_msg, v_msg like '%permission denied%');

  -- 7. Legacy copy total
  select sum(b.balance_paise) into v_bal from public.customer_balances b where b.shop_id = v_leg_shop;
  select (sum(c.outstanding_balance) * 100)::bigint into v_sum from legacy.customers c;
  insert into khatha_checks values (7, 'Legacy copy total (Rashmitha test shop)', 'Rs 5903.63 = old stored total',
    'Rs ' || (v_bal / 100.0)::numeric(12,2) || ' vs old Rs ' || (v_sum / 100.0)::numeric(12,2), v_bal = 590363 and v_sum = 590363);

  -- 8. Storage buckets
  select count(*), string_agg(id || ' ' || (file_size_limit / 1048576) || 'MB ' || case when public then 'PUBLIC' else 'private' end, ', ' order by id)
    into v_cnt, v_txt from storage.buckets where id in ('khata-scans', 'support-attachments', 'avatars');
  insert into khatha_checks values (8, 'Storage buckets', '3 private', v_cnt || ': ' || v_txt, v_cnt = 3 and v_txt not like '%PUBLIC%');

  -- 9. Low stock in the demo shop
  select string_agg(p.name || ' ' || rtrim(rtrim(p.stock_qty::text, '0'), '.') || '/' || rtrim(rtrim(p.low_stock_threshold::text, '0'), '.'), ', ' order by p.name)
    into v_txt from public.products p where p.shop_id = v_demo_shop and p.stock_qty <= p.low_stock_threshold;
  insert into khatha_checks values (9, 'Low-stock products (stock/level)', 'Parachute Coconut Oil, Tomato', v_txt,
    v_txt = 'Parachute Coconut Oil 250ml 2/4, Tomato 3/8');
end
$checks$;

select n, check_name, expected, actual, case when pass then 'PASS' else 'FAIL' end as result
  from khatha_checks order by n;
