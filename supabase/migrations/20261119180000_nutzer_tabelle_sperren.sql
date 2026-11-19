-- ══════════════════════════════════════════════════════════
-- SICHERHEIT: Tabelle nutzer vollständig für den öffentlichen anon key sperren
--
-- Befund (19.11.2026): In der Live-Datenbank war nutzer über den anon key
-- komplett lesbar – inklusive Namen, NFC-Karten-UIDs und Passwort-Hashes.
-- 20260821120000_harden_nutzer_exposure.sql hatte nur die Policy
-- "nutzer_select" entfernt; die live von Hand angelegte Tabelle hatte aber
-- offenbar noch eine weitere, frei lesbare Policy (oder kein aktives RLS).
--
-- Lösung, unabhängig davon, welche Policies es live gibt:
--   1. RLS auf nutzer einschalten,
--   2. ALLE Policies auf nutzer entfernen,
--   3. dem anon key und authenticated sämtliche Tabellenrechte entziehen.
-- Die App braucht keinen direkten Zugriff: Login, Profil, NFC-Abfrage usw.
-- laufen über security-definer-Funktionen, die mit Owner-Rechten lesen.
-- ══════════════════════════════════════════════════════════

alter table nutzer enable row level security;

do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'nutzer' loop
    execute format('drop policy %I on public.nutzer', p.policyname);
  end loop;
end $$;

revoke all on nutzer from anon, authenticated;
