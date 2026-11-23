-- ══════════════════════════════════════════════════════════
-- Testsystem: Gast-Buchungen bleiben 20 Minuten sichtbar (statt 2 Minuten)
--
-- Alle Gäste und der Admin teilen sich EIN gemeinsames Testsystem für die
-- Buchungen der Standard-Räume – jeder sieht dort die Test-Buchungen aller
-- anderen (fremde nur als "belegt"). Mit dem bisherigen Aufräumen nach
-- 2 Minuten waren Gast-Buchungen meist schon gelöscht, bevor der Admin
-- (oder ein anderer Gast) sie überhaupt sehen konnte.
--
-- Unverändert bleibt:
--   • Gast-Etagen sind privat je Sitzung (gast_etagen_laden) und werden
--     nach 15 Min. ohne Änderung gelöscht,
--   • Limit 10 Änderungen in 2 Min. je Sitzung (gast_aenderung_zaehlen),
--   • gast_zuruecksetzen() / testsystem_leeren() löschen sofort.
-- Frontend-Gegenstück: GAST_LOESCH_MINUTEN in js/config.js.
-- ══════════════════════════════════════════════════════════

create or replace function test_buchungen_aufraeumen()
returns void
language sql
security definer
set search_path = public
as $$
  delete from buchungen where test and erstellt < now() - interval '20 minutes';
  delete from gast_etagen where aktualisiert < now() - interval '15 minutes';
  delete from gast_aenderungen where zeit < now() - interval '2 minutes';
$$;

grant execute on function test_buchungen_aufraeumen() to anon, authenticated;
