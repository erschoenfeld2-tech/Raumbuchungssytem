// ══════════════════════════════════════════════════════════
// KONFIGURATION der Live-App
// Supabase: Projekteinstellungen → API → Project URL / anon public key.
// Der anon key ist bewusst öffentlich (Zugriff regeln die RLS-Policies
// in supabase/migrations/, siehe CLAUDE.md) – er ist KEIN Secret.
// Das Admin-Passwort steht seit Migration 20261119150000 NICHT mehr hier,
// sondern gehasht in der Datenbank.
// ══════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://yugjccgblqsfjasienwa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1Z2pjY2dibHFzZmphc2llbndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDQ3NDMsImV4cCI6MjEwMDcyMDc0M30.LW2n0hkDPqbP2HGQF6jPL2_Ma66EeO6kG5A2huvFuPM';

// Sichtbarer Zeitraum der Kalenderansicht (volle Stunden)
const H_START = 7, H_ENDE = 20;
// Höhe einer Halbstunden-Zeile im Kalender in Pixeln (muss zu .cal-row in css/app.css passen)
const ZEILE_PX = 48;
// Wie oft die Ansicht neue Buchungen lädt (Millisekunden)
const AKTUALISIERUNG_MS = 5000;

// Gemeinsamer Nutzer des Testsystems (siehe Migration 20261119120000_gast_testsystem.sql)
const GAST_NAME = 'Gast';
// Nach wie vielen Minuten Test-Buchungen gelöscht werden (nur Anzeige-Text –
// der echte Wert steht in der Funktion test_buchungen_aufraeumen() in der DB)
const GAST_LOESCH_MINUTEN = 2;

// localStorage-Schlüssel (nur Komfort: angemeldeter Nutzer, letzte Etage)
const SPEICHER_USER = 'rb_user2';
const SPEICHER_ETAGE = 'rb_etage';

const CONFIGURED = SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20;
const supa = CONFIGURED && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
