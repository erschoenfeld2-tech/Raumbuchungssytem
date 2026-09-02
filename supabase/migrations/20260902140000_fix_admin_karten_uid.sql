-- ══════════════════════════════════════════════════════════
-- Admin-Karten-UID korrigieren (Tippfehler in 20260902130000)
-- ══════════════════════════════════════════════════════════
-- Die vorherige Migration hat Admin_Universal die UID 'B851FBE7'
-- zugewiesen. Ein Testscan mit nfc_supabase_bridge.py zeigt aber,
-- dass die physische Admin-Karte tatsächlich als 'B851FBEF' gelesen
-- wird (letztes Zeichen F statt 7 vertippt).

update nutzer set nfc_uid = 'B851FBEF'
where name = 'Admin_Universal' and nfc_uid = 'B851FBE7';
