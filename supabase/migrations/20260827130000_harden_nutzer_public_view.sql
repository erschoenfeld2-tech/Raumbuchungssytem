-- ══════════════════════════════════════════════════════════
-- Härtung + Dokumentation: Supabase Security Advisor meldet
-- "Security Definer View" für public.nutzer_public.
--
-- Das ist hier eine BEWUSSTE, geprüfte Design-Entscheidung, keine
-- übersehene Schwachstelle:
--
-- nutzer_public wurde in 20260821120000_harden_nutzer_exposure.sql
-- absichtlich mit security_invoker = false angelegt, weil die
-- Basistabelle nutzer für anon/authenticated KEINE SELECT-Policy
-- mehr hat (die alte "nutzer_select"-Policy wurde in derselben
-- Migration gelöscht, um nfc_uid vor dem öffentlichen anon key zu
-- schützen). Würde man security_invoker = true setzen, liefe die
-- View mit den Rechten der abfragenden Rolle – die hat aber keinen
-- Zugriff auf nutzer, die View würde für alle 0 Zeilen liefern und
-- Login-Lookup/nutzerMap in index.html wären funktionsunfähig.
-- Eine permissive using(true)-Policy auf nutzer zurückzubringen
-- würde nfc_uid wieder direkt abgreifbar machen – genau das, was
-- die ursprüngliche Migration verhindern sollte.
--
-- Härtung statt Verhaltensänderung: Basistabelle schema-qualifiziert
-- referenzieren (schließt eine theoretische search_path-Manipulation
-- aus) und die Entscheidung als DB-Kommentar festhalten, damit das
-- Advisor-Finding bei künftigen Scans klar als geprüfte Ausnahme
-- erkennbar ist.
-- ══════════════════════════════════════════════════════════

create or replace view nutzer_public
  with (security_invoker = false)
  as select id, name, ist_admin from public.nutzer;

comment on view nutzer_public is
  'Security Advisor "Security Definer View": bewusst akzeptiert. '
  'Grund: nutzer hat keine SELECT-Policy fuer anon/authenticated '
  '(nfc_uid soll nicht ueber den anon key lesbar sein). Die View '
  'muss daher mit Owner-Rechten laufen, um id/name/ist_admin '
  'gezielt freizugeben. Details: '
  'supabase/migrations/20260821120000_harden_nutzer_exposure.sql '
  'und 20260827130000_harden_nutzer_public_view.sql.';
