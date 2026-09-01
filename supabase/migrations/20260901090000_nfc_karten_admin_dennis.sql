-- ══════════════════════════════════════════════════════════
-- NFC-Karten-Zuordnung an reale Testkarten anpassen.
--
-- Beim Live-Test der NFC-Brücke (nfc_supabase_bridge.py) hat sich
-- gezeigt, dass die Karte mit UID B851FBE7 tatsächlich dem
-- Admin-Account gehört, nicht Luca Guinness (so ursprünglich in
-- 20260821000000_init_schema.sql geraten). Außerdem kommt ein neuer
-- Nutzer "Dennis" mit einer eigenen Karte (A8F977EF) dazu.
--
-- Reihenfolge wichtig: nfc_uid ist unique, daher muss die Karte erst
-- bei Luca Guinness entfernt werden, bevor sie dem Admin zugewiesen
-- werden kann.
-- ══════════════════════════════════════════════════════════

update nutzer set nfc_uid = null
where name = 'Luca Guinness' and nfc_uid = 'B851FBE7';

update nutzer set nfc_uid = 'B851FBE7'
where name = 'Admin_Universal';

insert into nutzer (name, nfc_uid) values ('Dennis', 'A8F977EF')
on conflict (name) do update set nfc_uid = excluded.nfc_uid;
