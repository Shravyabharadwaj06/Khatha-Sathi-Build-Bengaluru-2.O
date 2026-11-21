-- Khatha Sathi demo data ("Sri Lakshmi Kirana Stores"). Safe to run more than once:
-- every row has a fixed id (md5 of a name) and every insert is ON CONFLICT DO NOTHING.
-- Dates are relative to the moment it is FIRST run (e.g. "yesterday" = 1 day before that run).
--
-- Demo login (demo-only credentials, not a secret):
--   email    demo@chotu.shop
--   phone    9876543210
--   password Demo@1234
--
-- What it contains:
--   * 21 kirana products with Hindi/Kannada aliases, units, prices and opening stock
--   * TWO customers named Ravi: "Ravi (Gandhi Nagar)" and a Ravi with no locality who bought rice yesterday
--   * Ramesh: 562 + 478 udhaar - 200 paid = Rs 840 exactly
--   * 5 customers owing for more than 30 days: Suresh, Manjunath, Fatima, Venkatesh, Shabana
--   * a week of walk-in cash/UPI sales, udhaar, a partial payment and repayments
--   * 2 products below their low-stock level (Tomato, Parachute Coconut Oil)

do $seed$
declare
  v_owner uuid := md5('khatha:demo:owner')::uuid;
  v_shop  uuid := md5('khatha:demo:shop')::uuid;

  -- k=key, n=name, a=aliases, c=category, u=unit, s=selling paise, b=purchase paise, o=opening stock, l=low-stock level
  v_products jsonb := $json$[
    {"k":"milk",    "n":"Nandini Toned Milk 500ml",   "a":["milk","doodh","haalu","nandini"],                "c":"Dairy",         "u":"packet","s":2700, "b":2500, "o":60, "l":10},
    {"k":"rice",    "n":"Sona Masoori Rice",          "a":["rice","chawal","akki","sona masoori"],           "c":"Grains",        "u":"kg",    "s":6200, "b":5400, "o":120,"l":20},
    {"k":"salt",    "n":"Tata Salt 1kg",              "a":["salt","namak","uppu","tata namak"],              "c":"Grocery",       "u":"packet","s":2800, "b":2400, "o":40, "l":8},
    {"k":"oil",     "n":"Fortune Sunflower Oil 1L",   "a":["oil","tel","enne","fortune tel","sunflower oil"],"c":"Oil",           "u":"packet","s":16500,"b":15000,"o":30, "l":6},
    {"k":"bread",   "n":"Modern Bread 400g",          "a":["bread","pav","double roti"],                     "c":"Bakery",        "u":"packet","s":4500, "b":3800, "o":15, "l":5},
    {"k":"sugar",   "n":"Sugar",                      "a":["sugar","cheeni","shakkar","sakkare"],            "c":"Grocery",       "u":"kg",    "s":4600, "b":4000, "o":80, "l":15},
    {"k":"atta",    "n":"Aashirvaad Atta 5kg",        "a":["atta","gehun atta","godhi hittu","aashirvaad"],  "c":"Grains",        "u":"packet","s":28500,"b":26000,"o":20, "l":4},
    {"k":"toor",    "n":"Toor Dal",                   "a":["dal","toor dal","arhar dal","togari bele"],      "c":"Pulses",        "u":"kg",    "s":16000,"b":14200,"o":40, "l":8},
    {"k":"moong",   "n":"Moong Dal",                  "a":["moong dal","hesaru bele"],                       "c":"Pulses",        "u":"kg",    "s":13000,"b":11500,"o":25, "l":5},
    {"k":"eggs",    "n":"Eggs",                       "a":["egg","eggs","anda","motte"],                     "c":"Dairy",         "u":"piece", "s":700,  "b":580,  "o":180,"l":30},
    {"k":"curd",    "n":"Nandini Curd 500g",          "a":["curd","dahi","mosaru"],                          "c":"Dairy",         "u":"packet","s":3000, "b":2600, "o":20, "l":6},
    {"k":"tea",     "n":"Red Label Tea 250g",         "a":["tea","chai patti","chaha pudi","red label"],     "c":"Beverages",     "u":"packet","s":14000,"b":12500,"o":18, "l":4},
    {"k":"biscuit", "n":"Parle-G Biscuit",            "a":["biscuit","parle g","parle"],                     "c":"Snacks",        "u":"packet","s":1000, "b":850,  "o":100,"l":20},
    {"k":"maggi",   "n":"Maggi Noodles 70g",          "a":["maggi","noodles"],                               "c":"Snacks",        "u":"packet","s":1400, "b":1200, "o":60, "l":12},
    {"k":"onion",   "n":"Onion",                      "a":["onion","pyaz","eerulli"],                        "c":"Vegetables",    "u":"kg",    "s":4000, "b":3200, "o":50, "l":10},
    {"k":"potato",  "n":"Potato",                     "a":["potato","aloo","aalugadde"],                     "c":"Vegetables",    "u":"kg",    "s":3500, "b":2800, "o":45, "l":10},
    {"k":"tomato",  "n":"Tomato",                     "a":["tomato","tamatar"],                              "c":"Vegetables",    "u":"kg",    "s":3000, "b":2200, "o":6,  "l":8},
    {"k":"surf",    "n":"Surf Excel 1kg",             "a":["surf","detergent","washing powder"],             "c":"Household",     "u":"packet","s":14000,"b":12600,"o":12, "l":4},
    {"k":"soap",    "n":"Lifebuoy Soap 100g",         "a":["soap","sabun","lifebuoy"],                       "c":"Personal Care", "u":"piece", "s":3800, "b":3300, "o":24, "l":6},
    {"k":"coconut", "n":"Parachute Coconut Oil 250ml","a":["coconut oil","nariyal tel","kobbari enne","parachute"],"c":"Oil",     "u":"bottle","s":11000,"b":9800, "o":3,  "l":4},
    {"k":"ragi",    "n":"Ragi Flour",                 "a":["ragi","ragi hittu","nachni"],                    "c":"Grains",        "u":"kg",    "s":5500, "b":4700, "o":30, "l":6}
  ]$json$;

  -- k=key, n=name, loc=locality, ph=phone, al=aliases
  v_customers jsonb := $json$[
    {"k":"ravi_gn",   "n":"Ravi",      "loc":"Gandhi Nagar",  "ph":"9845012345", "al":[]},
    {"k":"ravi_2",    "n":"Ravi",      "loc":null,            "ph":"9900112233", "al":[]},
    {"k":"ramesh",    "n":"Ramesh",    "loc":"Seshadripuram", "ph":"9886054321", "al":["ramesh anna"]},
    {"k":"lakshmi",   "n":"Lakshmi",   "loc":"Malleshwaram",  "ph":"9741122334", "al":["lakshmi akka"]},
    {"k":"anitha",    "n":"Anitha",    "loc":"Gandhi Nagar",  "ph":"9663344556", "al":[]},
    {"k":"kiran",     "n":"Kiran",     "loc":"Rajajinagar",   "ph":null,         "al":[]},
    {"k":"suresh",    "n":"Suresh",    "loc":"Majestic",      "ph":"9844455667", "al":[]},
    {"k":"manjunath", "n":"Manjunath", "loc":"Seshadripuram", "ph":"9980011223", "al":["manju"]},
    {"k":"fatima",    "n":"Fatima",    "loc":"Shivajinagar",  "ph":"9738899001", "al":[]},
    {"k":"venkatesh", "n":"Venkatesh", "loc":"Malleshwaram",  "ph":"9900887766", "al":["venki"]},
    {"k":"shabana",   "n":"Shabana",   "loc":"Gandhi Nagar",  "ph":"9611223344", "al":[]}
  ]$json$;

  -- Sales. cust=null is a walk-in. d/h = days/hours before the first run.
  -- mode: cash | upi | udhaar | partial (paid = amount paid now, in paise). Totals are computed from the items.
  v_sales jsonb := $json$[
    {"k":"S01","cust":"suresh",   "d":52,"h":3,"mode":"udhaar", "items":[["rice",10],["toor",2],["oil",2]]},
    {"k":"S02","cust":"manjunath","d":47,"h":5,"mode":"udhaar", "items":[["atta",1],["sugar",5],["tea",1]]},
    {"k":"S03","cust":"fatima",   "d":41,"h":2,"mode":"udhaar", "items":[["oil",3],["rice",5],["moong",1]]},
    {"k":"S04","cust":"venkatesh","d":38,"h":6,"mode":"udhaar", "items":[["surf",2],["soap",4],["ragi",3]]},
    {"k":"S05","cust":"shabana",  "d":35,"h":4,"mode":"udhaar", "items":[["milk",10],["sugar",2],["biscuit",6]]},
    {"k":"S06","cust":"ravi_gn",  "d":12,"h":3,"mode":"udhaar", "items":[["toor",1],["sugar",2],["salt",1]]},
    {"k":"S08","cust":"ramesh",   "d":9, "h":2,"mode":"udhaar", "items":[["rice",5],["toor",1],["sugar",2]]},
    {"k":"S10","cust":"lakshmi",  "d":6, "h":5,"mode":"partial","paid":20000, "items":[["curd",2],["milk",4],["eggs",12],["bread",1]]},
    {"k":"W01","cust":null,       "d":6, "h":2,"mode":"cash",   "items":[["milk",4],["bread",1]]},
    {"k":"W02","cust":null,       "d":6, "h":1,"mode":"upi",    "items":[["rice",2],["toor",0.5]]},
    {"k":"W03","cust":null,       "d":5, "h":6,"mode":"cash",   "items":[["eggs",6],["maggi",2]]},
    {"k":"W04","cust":null,       "d":5, "h":3,"mode":"cash",   "items":[["onion",1.5],["tomato",1],["potato",1]]},
    {"k":"S09","cust":"ramesh",   "d":4, "h":4,"mode":"udhaar", "items":[["oil",1],["salt",1],["atta",1]]},
    {"k":"W05","cust":null,       "d":4, "h":3,"mode":"upi",    "items":[["oil",1],["atta",1]]},
    {"k":"W06","cust":null,       "d":4, "h":1,"mode":"cash",   "items":[["milk",2],["curd",1]]},
    {"k":"S11","cust":"anitha",   "d":3, "h":5,"mode":"udhaar", "items":[["onion",2],["potato",2],["tomato",1]]},
    {"k":"W07","cust":null,       "d":3, "h":3,"mode":"cash",   "items":[["soap",2],["surf",1]]},
    {"k":"W08","cust":null,       "d":3, "h":1,"mode":"upi",    "items":[["tea",1],["sugar",1],["biscuit",2]]},
    {"k":"S12","cust":"kiran",    "d":2, "h":6,"mode":"upi",    "items":[["maggi",4],["biscuit",4],["eggs",6]]},
    {"k":"W09","cust":null,       "d":2, "h":4,"mode":"cash",   "items":[["rice",3],["moong",0.5]]},
    {"k":"W10","cust":null,       "d":2, "h":2,"mode":"cash",   "items":[["milk",6],["bread",2]]},
    {"k":"S07","cust":"ravi_2",   "d":1, "h":5,"mode":"udhaar", "items":[["rice",5],["milk",2]]},
    {"k":"W11","cust":null,       "d":1, "h":3,"mode":"upi",    "items":[["coconut",1],["soap",1]]},
    {"k":"W12","cust":null,       "d":1, "h":1,"mode":"cash",   "items":[["tomato",1],["onion",1]]},
    {"k":"W13","cust":null,       "d":0, "h":3,"mode":"cash",   "items":[["milk",4],["eggs",6]]},
    {"k":"W14","cust":null,       "d":0, "h":1,"mode":"upi",    "items":[["ragi",1],["salt",1],["sugar",1]]}
  ]$json$;

  -- Payments (paise)
  v_payments jsonb := $json$[
    {"k":"P01","cust":"suresh", "d":40,"h":2,"mode":"cash","amt":50000},
    {"k":"P02","cust":"fatima", "d":33,"h":3,"mode":"upi", "amt":30000},
    {"k":"P03","cust":"ravi_gn","d":5, "h":2,"mode":"cash","amt":10000},
    {"k":"P05","cust":"lakshmi","d":3, "h":2,"mode":"cash","amt":9700},
    {"k":"P04","cust":"ramesh", "d":2, "h":3,"mode":"upi", "amt":20000}
  ]$json$;
begin
  -- Recorded as the demo owner in created_by and audit_log.
  perform set_config('app.user_id', v_owner::text, true);

  -- Demo login
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated', 'demo@chotu.shop',
          extensions.crypt('Demo@1234', extensions.gen_salt('bf')), now(),
          '{"provider": "email", "providers": ["email"]}', '{"name": "Demo Owner"}', now(), now(), '', '', '', '')
  on conflict (id) do nothing;

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_owner::text, v_owner,
          jsonb_build_object('sub', v_owner::text, 'email', 'demo@chotu.shop', 'email_verified', true),
          'email', now(), now())
  on conflict (provider_id, provider) do nothing;

  -- Shop, profile, settings
  insert into public.shops (id, owner_user_id, shop_name, city, business_domain, address, gst_number, fssai_number)
  values (v_shop, v_owner, 'Sri Lakshmi Kirana Stores', 'Bengaluru', 'Grocery',
          'No. 12, 4th Cross, Gandhi Nagar, Bengaluru 560009', '29ABCDE1234F1Z5', '11223344001928')
  on conflict (id) do nothing;

  insert into public.profiles (user_id, shop_id, owner_name, phone, email, primary_language, secondary_language, consent_at)
  values (v_owner, v_shop, 'Demo Owner', '9876543210', 'demo@chotu.shop',
          'Kannada (ಕನ್ನಡ) - Southern Dialect', 'Hindi (हिन्दी) - Hinglish Hybrid', now())
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id) values (v_owner) on conflict (user_id) do nothing;

  -- Products, then their opening stock (60 days ago, before any sale)
  insert into public.products (id, shop_id, name, aliases, category, unit, selling_price_paise, purchase_price_paise, low_stock_threshold)
  select md5('khatha:demo:product:' || p.k)::uuid, v_shop, p.n, p.a, p.c, p.u, p.s, p.b, p.l
    from jsonb_to_recordset(v_products) as p(k text, n text, a text[], c text, u text, s bigint, b bigint, o numeric, l numeric)
  on conflict (id) do nothing;

  insert into public.stock_movements (id, shop_id, product_id, qty_change, reason, note, created_by, created_at)
  select md5('khatha:demo:opening:' || p.k)::uuid, v_shop, md5('khatha:demo:product:' || p.k)::uuid, p.o, 'opening',
         'Opening stock', v_owner, now() - interval '60 days'
    from jsonb_to_recordset(v_products) as p(k text, o numeric)
  on conflict (id) do nothing;

  -- Customers
  insert into public.customers (id, shop_id, name, aliases, locality, phone, whatsapp)
  select md5('khatha:demo:customer:' || c.k)::uuid, v_shop, c.n, c.al, c.loc, c.ph, c.ph
    from jsonb_to_recordset(v_customers) as c(k text, n text, loc text, ph text, al text[])
  on conflict (id) do nothing;

  -- Sales (amount = sum of the items, computed here from the product prices)
  insert into public.ledger_entries (id, shop_id, customer_id, type, amount_paise, paid_paise, payment_mode,
                                     source, created_by, created_at)
  with s as (
    select * from jsonb_to_recordset(v_sales) as s(k text, cust text, d int, h int, mode text, paid bigint, items jsonb)
  ), li as (
    select s.k, x.it ->> 0 as pk, (x.it ->> 1)::numeric as qty
      from s, jsonb_array_elements(s.items) as x(it)
  ), tot as (
    select li.k, sum(round(li.qty * p.selling_price_paise))::bigint as amount
      from li join public.products p on p.id = md5('khatha:demo:product:' || li.pk)::uuid
     group by li.k
  )
  select md5('khatha:demo:entry:' || s.k)::uuid, v_shop,
         case when s.cust is null then null else md5('khatha:demo:customer:' || s.cust)::uuid end,
         'sale', tot.amount,
         case s.mode when 'udhaar' then 0 when 'partial' then s.paid else tot.amount end,
         s.mode, 'manual', v_owner, now() - make_interval(days => s.d, hours => s.h)
    from s join tot on tot.k = s.k
  on conflict (id) do nothing;

  insert into public.ledger_items (id, shop_id, entry_id, product_id, product_name_snapshot, qty, unit,
                                   unit_price_paise, line_total_paise, created_at)
  select md5('khatha:demo:item:' || s.k || ':' || x.ord)::uuid, v_shop, e.id, p.id, p.name,
         (x.it ->> 1)::numeric, p.unit, p.selling_price_paise,
         round((x.it ->> 1)::numeric * p.selling_price_paise)::bigint, e.created_at
    from jsonb_to_recordset(v_sales) as s(k text, items jsonb)
   cross join lateral jsonb_array_elements(s.items) with ordinality as x(it, ord)
    join public.products p on p.id = md5('khatha:demo:product:' || (x.it ->> 0))::uuid
    join public.ledger_entries e on e.id = md5('khatha:demo:entry:' || s.k)::uuid
  on conflict (id) do nothing;

  -- Stock goes down for every item sold
  insert into public.stock_movements (id, shop_id, product_id, entry_id, qty_change, reason, created_by, created_at)
  select md5('khatha:demo:stock:' || i.id)::uuid, v_shop, i.product_id, i.entry_id, -i.qty, 'sale', v_owner, i.created_at
    from public.ledger_items i
   where i.shop_id = v_shop
  on conflict (id) do nothing;

  -- Payments
  insert into public.ledger_entries (id, shop_id, customer_id, type, amount_paise, paid_paise, payment_mode,
                                     source, created_by, created_at)
  select md5('khatha:demo:entry:' || p.k)::uuid, v_shop, md5('khatha:demo:customer:' || p.cust)::uuid,
         'payment', p.amt, p.amt, p.mode, 'manual', v_owner, now() - make_interval(days => p.d, hours => p.h)
    from jsonb_to_recordset(v_payments) as p(k text, cust text, d int, h int, mode text, amt bigint)
  on conflict (id) do nothing;
end
$seed$;
