-- ══════════════════════════════════════════════════════════
-- Sicherheitshärtung: nfc_uid nicht mehr über den öffentlichen
-- anon key auslesbar.
--
-- Hintergrund: der anon key liegt öffentlich sichtbar in index.html
-- (das ist bei Supabase so vorgesehen, Zugriff wird über RLS
-- geregelt – siehe CLAUDE.md). Die bisherige Policy "nutzer_select"
-- (migration 20260821000000_init_schema.sql) erlaubte mit
-- "using (true)" aber JEDEM Besitzer des anon keys ein
-- "select * from nutzer", inklusive nfc_uid (Kartennummern) und
-- ist_admin für alle Zeilen. Die Web-App selbst braucht nie mehr als
-- id/name/ist_admin (siehe index.html: Login-Lookup & nutzerMap).
--
-- Lösung: Direktzugriff auf die Basistabelle für anon/authenticated
-- sperren, stattdessen eine View ohne nfc_uid freigeben. Views laufen
-- standardmäßig mit den Rechten ihres Besitzers (kein
-- security_invoker), RLS der Basistabelle bleibt für alle anderen
-- Rollen wirksam.
--
-- Nicht betroffen: buchungen bleibt unverändert (weiterhin offen für
-- Web + künftiges NFC-Skript, siehe bekannte Einschränkung in
-- CLAUDE.md zu fehlender echter Auth).
-- ══════════════════════════════════════════════════════════

drop policy if exists "nutzer_select" on nutzer;

create or replace view nutzer_public
  with (security_invoker = false)
  as select id, name, ist_admin from nutzer;

grant select on nutzer_public to anon, authenticated;
