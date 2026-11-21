-- Fuzzy (trigram) search for customer and product names.
create extension if not exists pg_trgm with schema extensions;
