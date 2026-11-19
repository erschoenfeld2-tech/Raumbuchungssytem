-- ══════════════════════════════════════════════════════════
-- Gast-Zugang / Testsystem für die Hausmesse
--
-- Das Testsystem läuft in derselben Datenbank, ist aber über die Spalte
-- buchungen.test strikt vom Echtbetrieb getrennt: Das Frontend zeigt im
-- Echtbetrieb nur test = false, im Gast-Modus nur test = true (plus die
-- Besprechungs-/Konferenzraum-Buchungen, die per NFC entstehen).
-- Test-Buchungen werden nach 2 Minuten automatisch gelöscht.
-- Das NFC-Skript schreibt weiter ohne die Spalte -> Default false.
-- ══════════════════════════════════════════════════════════

alter table buchungen add column if not exists test boolean not null default false;

-- Gemeinsamer Gast-Nutzer (kein Passwort, kein NFC -> normaler Login unmöglich,
-- nutzer_login verlangt einen passwort_hash)
insert into nutzer (name, passwort_muss_aendern) values ('Gast', false)
on conflict (name) do nothing;

-- Löscht abgelaufene Test-Buchungen. Läuft mit Owner-Rechten und rührt
-- ausschließlich test = true an; wird vom Frontend regelmäßig aufgerufen.
create or replace function test_buchungen_aufraeumen()
returns void
language sql
security definer
set search_path = public
as $$
  delete from buchungen
  where test and erstellt < now() - interval '2 minutes';
$$;

grant execute on function test_buchungen_aufraeumen() to anon, authenticated;
