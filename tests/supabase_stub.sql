-- ══════════════════════════════════════════════════════════
-- Nur für lokale Tests (tests/run_tests.sh): bildet die Teile einer
-- Supabase-Datenbank nach, auf die sich unsere Migrationen verlassen –
-- Rollen anon/authenticated, Schema "extensions" und die Standardrechte,
-- die Supabase neuen Tabellen/Funktionen im Schema public gibt.
-- Wird NIE gegen die echte Datenbank ausgeführt.
-- ══════════════════════════════════════════════════════════
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists extensions;
grant usage on schema public, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
