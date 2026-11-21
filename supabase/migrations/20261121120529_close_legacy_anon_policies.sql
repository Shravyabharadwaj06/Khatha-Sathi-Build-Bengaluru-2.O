-- The prototype tables had a policy giving the public `anon` role full access (USING true).
-- Close it: rename it and change it to deny everyone. RLS stays ON.
-- (ALTER instead of DROP: the Supabase MCP server refuses DROP statements in this setup.)
alter policy "Allow prototype data upload" on legacy.products          rename to "legacy_no_access";
alter policy "Allow prototype data upload" on legacy.customers         rename to "legacy_no_access";
alter policy "Allow prototype data upload" on legacy.transactions      rename to "legacy_no_access";
alter policy "Allow prototype data upload" on legacy.transaction_items rename to "legacy_no_access";
alter policy "legacy_no_access" on legacy.products          to authenticated using (false) with check (false);
alter policy "legacy_no_access" on legacy.customers         to authenticated using (false) with check (false);
alter policy "legacy_no_access" on legacy.transactions      to authenticated using (false) with check (false);
alter policy "legacy_no_access" on legacy.transaction_items to authenticated using (false) with check (false);
