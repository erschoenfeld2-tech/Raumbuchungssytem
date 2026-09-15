-- ══════════════════════════════════════════════════════════
-- Einzeltisch-Buchung: neue Spalte 'tisch' für die Nummerierung
-- der einzelnen Tische innerhalb eines Raums (siehe ROOM_DEFS /
-- tischCode() in index.html).
--
-- Format: <Etage>.<Raum-Nr><Tisch-Nr, 2-stellig>, z.B. 1.203 =
-- Etage 1, 2. Raum dieser Etage, 3. Tisch.
--
-- Nullable, weil ältere Zeilen und NFC-Buchungen
-- (nfc_supabase_bridge.py kennt nur den Raum, nicht den
-- konkreten Tisch) keinen Wert haben – die Kapazitätsprüfung
-- behandelt solche Zeilen weiterhin auf Raum-Ebene.
-- ══════════════════════════════════════════════════════════

alter table buchungen add column if not exists tisch text;
