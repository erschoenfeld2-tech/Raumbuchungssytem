-- ══════════════════════════════════════════════════════════
-- NFC-Karten-Zuordnung korrigieren
-- ══════════════════════════════════════════════════════════
-- Die Testdaten aus 20260821000000_init_schema.sql enthielten zwei
-- fehlerhafte nfc_uid-Werte:
--   - A8F977E7 bei "Berta Langenhahn" (Tippfehler, richtig: A8F977EF,
--     gehört zu Marie)
--   - B851FBE7 bei "Luca Guinness" (gehört tatsächlich zur
--     Admin-Karte, nicht zu Lucas Testnutzer)
--
-- Reihenfolge wichtig: nfc_uid ist unique, daher erst Luca die Karte
-- entziehen, bevor sie Admin_Universal zugewiesen wird.

update nutzer set nfc_uid = null
where name = 'Luca Guinness' and nfc_uid = 'B851FBE7';

update nutzer set nfc_uid = 'B851FBE7'
where name = 'Admin_Universal';

-- Berta Langenhahn -> Marie umbenennen und die UID korrigieren
update nutzer set name = 'Marie', nfc_uid = 'A8F977EF'
where name = 'Berta Langenhahn' and nfc_uid = 'A8F977E7';

-- Falls "Marie" bereits (unter diesem Namen) existiert, nur die UID
-- nachziehen statt des obigen Renames.
update nutzer set nfc_uid = 'A8F977EF'
where name = 'Marie' and nfc_uid is distinct from 'A8F977EF';
