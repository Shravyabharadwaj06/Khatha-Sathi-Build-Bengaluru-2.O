-- Balances are never stored: they are the SUM of ledger_entries.due_delta_paise, so they cannot drift.
-- All objects here are SECURITY INVOKER: for a signed-in user, RLS still applies.
-- Every function takes p_shop_id explicitly because the backend (which bypasses RLS) must always scope by shop.

-- Customer balance (paise). Positive = the customer owes the shop.
create or replace view public.customer_balances
with (security_invoker = true) as
select
  c.shop_id,
  c.id                                          as customer_id,
  c.name,
  c.locality,
  c.phone,
  c.archived_at,
  coalesce(sum(e.due_delta_paise), 0)::bigint   as balance_paise,
  count(e.id)                                   as entry_count,
  max(e.created_at)                             as last_entry_at
from public.customers c
left join public.ledger_entries e on e.shop_id = c.shop_id and e.customer_id = c.id
group by c.id;

-- The exact entries that add up to a customer's balance, oldest first, with a running total.
-- The last running_balance_paise equals customer_balances.balance_paise.
create or replace function public.explain_customer_balance(p_shop_id uuid, p_customer_id uuid)
returns table (
  entry_id              uuid,
  created_at            timestamptz,
  type                  text,
  payment_mode          text,
  amount_paise          bigint,
  paid_paise            bigint,
  due_delta_paise       bigint,
  running_balance_paise bigint,
  ref_entry_id          uuid,
  items_summary         text,
  note                  text
)
language sql stable set search_path = '' as $$
  select
    e.id,
    e.created_at,
    e.type,
    e.payment_mode,
    e.amount_paise,
    e.paid_paise,
    e.due_delta_paise,
    (sum(e.due_delta_paise) over (order by e.created_at, e.id rows between unbounded preceding and current row))::bigint,
    e.ref_entry_id,
    (select string_agg(i.product_name_snapshot || ' ' || rtrim(rtrim(i.qty::text, '0'), '.') || ' ' || i.unit, ', '
                       order by i.created_at, i.id)
       from public.ledger_items i
      where i.shop_id = e.shop_id and i.entry_id = e.id),
    e.note
  from public.ledger_entries e
  where e.shop_id = p_shop_id
    and e.customer_id = p_customer_id
    and e.due_delta_paise <> 0
  order by e.created_at, e.id
$$;

-- Customers whose oldest UNPAID amount is at least p_min_days old (payments clear the oldest dues first).
-- Reversed entries and their reversals are left out, because they cancel each other.
create or replace function public.customers_with_old_dues(p_shop_id uuid, p_min_days integer default 30)
returns table (
  customer_id      uuid,
  name             text,
  locality         text,
  phone            text,
  whatsapp         text,
  balance_paise    bigint,
  oldest_unpaid_at timestamptz,
  days_overdue     integer
)
language sql stable set search_path = '' as $$
  with live as (
    select e.id, e.customer_id, e.created_at, e.due_delta_paise
      from public.ledger_entries e
     where e.shop_id = p_shop_id
       and e.customer_id is not null
       and e.due_delta_paise <> 0
       and e.type <> 'reversal'
       and not exists (select 1 from public.ledger_entries r
                        where r.shop_id = e.shop_id and r.ref_entry_id = e.id and r.type = 'reversal')
  ),
  credits as (
    select l.customer_id, sum(-l.due_delta_paise) as paid
      from live l where l.due_delta_paise < 0 group by l.customer_id
  ),
  debits as (
    select l.customer_id, l.id, l.created_at,
           sum(l.due_delta_paise) over (partition by l.customer_id order by l.created_at, l.id) as cumulative
      from live l where l.due_delta_paise > 0
  ),
  oldest as (
    select distinct on (d.customer_id) d.customer_id, d.created_at
      from debits d
      left join credits cr on cr.customer_id = d.customer_id
     where d.cumulative > coalesce(cr.paid, 0)
     order by d.customer_id, d.created_at, d.id
  ),
  balances as (
    select l.customer_id, sum(l.due_delta_paise)::bigint as balance from live l group by l.customer_id
  )
  select c.id, c.name, c.locality, c.phone, c.whatsapp, b.balance, o.created_at,
         floor(extract(epoch from (now() - o.created_at)) / 86400)::integer
    from oldest o
    join balances b on b.customer_id = o.customer_id
    join public.customers c on c.shop_id = p_shop_id and c.id = o.customer_id
   where b.balance > 0
     and c.archived_at is null
     and o.created_at <= now() - make_interval(days => greatest(p_min_days, 0))
   order by o.created_at, c.name
$$;

-- Fuzzy customer search on name + aliases + locality (trigram word similarity, typo-tolerant).
create or replace function public.search_customers(p_shop_id uuid, p_query text, p_limit integer default 10)
returns table (customer_id uuid, name text, locality text, phone text, score real)
language sql stable set search_path = '' as $$
  with q as (select lower(btrim(p_query)) as t)
  select c.id, c.name, c.locality, c.phone,
         greatest(extensions.word_similarity(q.t, c.search_text),
                  case when strpos(c.search_text, q.t) > 0 then 1 else 0 end)::real as score
    from public.customers c, q
   where c.shop_id = p_shop_id
     and c.archived_at is null
     and q.t <> ''
     and (q.t operator(extensions.<%) c.search_text or strpos(c.search_text, q.t) > 0)
   order by score desc, c.name
   limit least(greatest(p_limit, 1), 50)
$$;

-- Fuzzy product search on name + aliases + category.
create or replace function public.search_products(p_shop_id uuid, p_query text, p_limit integer default 10)
returns table (product_id uuid, name text, unit text, selling_price_paise bigint, stock_qty numeric, score real)
language sql stable set search_path = '' as $$
  with q as (select lower(btrim(p_query)) as t)
  select p.id, p.name, p.unit, p.selling_price_paise, p.stock_qty,
         greatest(extensions.word_similarity(q.t, p.search_text),
                  case when strpos(p.search_text, q.t) > 0 then 1 else 0 end)::real as score
    from public.products p, q
   where p.shop_id = p_shop_id
     and p.archived_at is null
     and q.t <> ''
     and (q.t operator(extensions.<%) p.search_text or strpos(p.search_text, q.t) > 0)
   order by score desc, p.name
   limit least(greatest(p_limit, 1), 50)
$$;

revoke all on public.customer_balances from anon, authenticated;
grant select on public.customer_balances to authenticated;

revoke all on function public.explain_customer_balance(uuid, uuid), public.customers_with_old_dues(uuid, integer),
  public.search_customers(uuid, text, integer), public.search_products(uuid, text, integer) from public, anon;
grant execute on function public.explain_customer_balance(uuid, uuid), public.customers_with_old_dues(uuid, integer),
  public.search_customers(uuid, text, integer), public.search_products(uuid, text, integer) to authenticated, service_role;
