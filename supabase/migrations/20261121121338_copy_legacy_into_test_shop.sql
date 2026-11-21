-- Copy Rashmitha's prototype data (legacy.*) into its own shop, "Rashmitha test shop".
-- The legacy tables are only READ; nothing in them is changed or deleted.
-- IDs are derived from the old IDs (md5), and every insert is ON CONFLICT DO NOTHING, so this is safe to re-run.
-- Mapping: rupees -> paise; credit_sale -> sale/udhaar; cash_sale -> sale/cash; payment -> payment (cash/upi);
-- the old stored outstanding_balance is NOT copied - balances are recomputed from the ledger.
-- Current stock is copied as one 'import' stock movement per product (the old sales are history only).

-- 1) Login for the test shop. Its password is random and not stored anywhere:
--    set one in Dashboard -> Authentication -> Users if someone needs to sign in as this shop.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', md5('khatha:legacy-owner')::uuid, 'authenticated', 'authenticated',
        'rashmitha.test@chotu.shop',
        extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
        now(), '{"provider": "email", "providers": ["email"]}', '{"name": "Rashmitha (test shop)"}', now(), now(),
        '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values (md5('khatha:legacy-owner')::uuid::text, md5('khatha:legacy-owner')::uuid,
        jsonb_build_object('sub', md5('khatha:legacy-owner')::uuid::text, 'email', 'rashmitha.test@chotu.shop', 'email_verified', true),
        'email', now(), now())
on conflict (provider_id, provider) do nothing;

-- 2) Shop, profile, settings
insert into public.shops (id, owner_user_id, shop_name, city, business_domain)
values (md5('khatha:legacy-shop')::uuid, md5('khatha:legacy-owner')::uuid, 'Rashmitha test shop', 'Bengaluru', 'Grocery')
on conflict (id) do nothing;

insert into public.profiles (user_id, shop_id, owner_name, phone, email)
values (md5('khatha:legacy-owner')::uuid, md5('khatha:legacy-shop')::uuid, 'Rashmitha (test)', '9000000002', 'rashmitha.test@chotu.shop')
on conflict (user_id) do nothing;

insert into public.user_settings (user_id) values (md5('khatha:legacy-owner')::uuid) on conflict (user_id) do nothing;

-- 3) Products (stock starts at 0; the import stock movement below sets it)
insert into public.products (id, shop_id, name, category, unit, selling_price_paise, purchase_price_paise,
                             low_stock_threshold, expiry_date, legacy_ref)
select md5('khatha:legacy-product:' || p.product_id)::uuid, md5('khatha:legacy-shop')::uuid,
       btrim(p.product_name), p.category, coalesce(nullif(btrim(p.unit), ''), 'pcs'),
       round(p.selling_price * 100)::bigint,
       case when p.purchase_price is null then null else round(p.purchase_price * 100)::bigint end,
       coalesce(p.low_stock_threshold, 5), p.expiry_date, p.product_id
  from legacy.products p
on conflict (id) do nothing;

insert into public.stock_movements (id, shop_id, product_id, qty_change, reason, note)
select md5('khatha:legacy-stock:' || p.product_id)::uuid, md5('khatha:legacy-shop')::uuid,
       md5('khatha:legacy-product:' || p.product_id)::uuid, p.stock_quantity, 'import', 'Stock copied from prototype data'
  from legacy.products p
 where coalesce(p.stock_quantity, 0) > 0
on conflict (id) do nothing;

-- 4) Customers (placeholder phone numbers like TEST-C001 become empty)
insert into public.customers (id, shop_id, name, phone, whatsapp, credit_score, legacy_ref)
select md5('khatha:legacy-customer:' || c.customer_id)::uuid, md5('khatha:legacy-shop')::uuid,
       btrim(c.customer_name),
       case when c.phone_number ~ '^[0-9]{10}$' then c.phone_number end,
       case when c.whatsapp_number ~ '^[0-9]{10}$' then c.whatsapp_number end,
       c.credit_score, c.customer_id
  from legacy.customers c
on conflict (id) do nothing;

-- 5) Ledger entries, in date order (same-day rows are spaced 1 second apart to keep their order)
insert into public.ledger_entries (id, shop_id, customer_id, type, amount_paise, paid_paise, payment_mode,
                                   source, note, legacy_ref, created_at)
select md5('khatha:legacy-txn:' || t.transaction_id)::uuid, md5('khatha:legacy-shop')::uuid,
       case when t.customer_id is null then null else md5('khatha:legacy-customer:' || t.customer_id)::uuid end,
       case when t.transaction_type = 'payment' then 'payment' else 'sale' end,
       round(t.total_amount * 100)::bigint,
       case when t.transaction_type = 'credit_sale' then 0 else round(t.total_amount * 100)::bigint end,
       case when t.transaction_type = 'credit_sale' then 'udhaar'
            when t.payment_method = 'upi' then 'upi'
            else 'cash' end,
       'import', 'Copied from prototype data', t.transaction_id,
       coalesce(t.transaction_date, now())
         + make_interval(secs => row_number() over (order by t.transaction_date, t.transaction_id))
  from legacy.transactions t
on conflict (id) do nothing;

-- 6) Sale items
insert into public.ledger_items (id, shop_id, entry_id, product_id, product_name_snapshot, qty, unit,
                                 unit_price_paise, line_total_paise, created_at)
select md5('khatha:legacy-item:' || i.item_id)::uuid, md5('khatha:legacy-shop')::uuid,
       md5('khatha:legacy-txn:' || i.transaction_id)::uuid,
       md5('khatha:legacy-product:' || i.product_id)::uuid,
       btrim(p.product_name), i.quantity, coalesce(nullif(btrim(p.unit), ''), 'pcs'),
       round(i.unit_price * 100)::bigint, round(i.subtotal * 100)::bigint,
       e.created_at
  from legacy.transaction_items i
  join legacy.products p on p.product_id = i.product_id
  join public.ledger_entries e on e.id = md5('khatha:legacy-txn:' || i.transaction_id)::uuid
on conflict (id) do nothing;
