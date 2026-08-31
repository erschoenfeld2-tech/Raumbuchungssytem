-- ══════════════════════════════════════════════════════════
-- NFC-Check-in-Brücke: sichere UID→Nutzer-Auflösung für den
-- öffentlichen anon key, ohne die geschützte nfc_uid-Spalte
-- offenzulegen.
--
-- Hintergrund: 20260821120000_harden_nutzer_exposure.sql hat den
-- Direktzugriff auf nutzer.nfc_uid für anon/authenticated bewusst
-- gesperrt (keine SELECT-Policy mehr, nutzer_public liefert nur
-- id/name/ist_admin). Das neue lokale Brücken-Skript
-- (nfc_supabase_bridge.py) muss pro gescannter Karte trotzdem
-- herausfinden, welcher Nutzer sie besitzt, um in buchungen
-- (quelle='nfc') schreiben zu können.
--
-- Lösung nach demselben Muster wie nutzer_public: eine
-- security-definer-Funktion, die für eine EXAKT übergebene UID nur
-- id+name zurückgibt. Kein Bulk-Read der nfc_uid-Spalte möglich –
-- wer die Funktion aufruft, muss die UID der Karte bereits kennen
-- (er hält sie ja gerade an den Reader), bekommt aber nie die Liste
-- aller UIDs zu sehen.
-- ══════════════════════════════════════════════════════════

create or replace function public.nutzer_by_nfc(p_nfc_uid text)
returns table(id bigint, name text)
language sql
security definer
set search_path = public
as $$
  select id, name
  from nutzer
  where nfc_uid = p_nfc_uid
    and nfc_uid is not null;
$$;

grant execute on function public.nutzer_by_nfc(text) to anon, authenticated;
