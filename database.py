"""
Raumbuchungssystem – Datenbank (Phase 2 + Erweiterungen)
=========================================================
Erstellt die SQLite-Datenbank mit drei Tabellen:
  - rooms    : Räume und Desks (mit Kapazität)
  - users    : Nutzer mit NFC-Karten-UID
  - bookings : Buchungen (inkl. Walk-In und flexibles Desksharing)

Neu:
  - Kapazitätsprüfung für Mehrpersonen-Räume
  - Walk-In Buchung (ohne vorherige Online-Buchung)
  - Check-out Funktion (Endzeit wird beim Verlassen gesetzt)
  - Desksharing-Räume ohne feste Endzeit

Nutzung:
    py database.py
    → erstellt raumbuchung.db im selben Ordner
"""

import sqlite3
from datetime import datetime, timedelta

DB_PATH = "raumbuchung.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            type            TEXT NOT NULL CHECK(type IN ('desk', 'meeting')),
            capacity        INTEGER DEFAULT 1,
            nfc_reader_id   TEXT UNIQUE,
            description     TEXT,
            allow_walkin    INTEGER DEFAULT 1,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            email       TEXT UNIQUE NOT NULL,
            nfc_uid     TEXT UNIQUE,
            active      INTEGER DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Neu: checkout_at Spalte + source 'walkin' + open_end Flag
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id     INTEGER NOT NULL REFERENCES rooms(id),
            user_id     INTEGER NOT NULL REFERENCES users(id),
            start_time  DATETIME NOT NULL,
            end_time    DATETIME,
            status      TEXT DEFAULT 'booked'
                        CHECK(status IN ('booked','checked_in','completed','cancelled','no_show')),
            source      TEXT DEFAULT 'web'
                        CHECK(source IN ('web','nfc','admin','walkin')),
            checkin_at  DATETIME,
            checkout_at DATETIME,
            open_end    INTEGER DEFAULT 0,
            notified    INTEGER DEFAULT 0,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    conn.close()
    print("✓ Datenbank erfolgreich initialisiert: raumbuchung.db")


# ─────────────────────────────────────────────
#  RÄUME
# ─────────────────────────────────────────────

def add_room(name, room_type, capacity=1, nfc_reader_id=None,
             description=None, allow_walkin=True):
    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO rooms (name, type, capacity, nfc_reader_id,
                               description, allow_walkin)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, room_type, capacity, nfc_reader_id,
              description, 1 if allow_walkin else 0))
        conn.commit()
        print(f"✓ Raum '{name}' ({room_type}, Kap:{capacity}) hinzugefügt.")
    except sqlite3.IntegrityError as e:
        print(f"✗ Fehler: {e}")
    finally:
        conn.close()


def list_rooms():
    conn = get_connection()
    rooms = conn.execute("SELECT * FROM rooms").fetchall()
    conn.close()
    print("\n── Räume ──────────────────────────────────────")
    for r in rooms:
        walkin = "Walk-In ✓" if r['allow_walkin'] else "Nur Vorab-Buchung"
        print(f"  [{r['id']}] {r['name']} | {r['type']} | "
              f"Kap:{r['capacity']} | {walkin} | "
              f"Reader: {r['nfc_reader_id'] or '–'}")
    print()
    return rooms


def get_active_checkins(room_id):
    """
    Zählt aktuell eingecheckte Nutzer in einem Raum (LIVE).
    Nur wer eingecheckt und noch nicht ausgecheckt ist.
    """
    conn = get_connection()
    count = conn.execute("""
        SELECT COUNT(*) FROM bookings
        WHERE room_id = ?
          AND status = 'checked_in'
          AND checkin_at IS NOT NULL
          AND checkout_at IS NULL
    """, (room_id,)).fetchone()[0]
    conn.close()
    return count


def get_occupancy_at(room_id, zeitpunkt=None):
    """
    Zählt wie viele Plätze zu einem bestimmten Zeitpunkt belegt sind.
    Berücksichtigt sowohl aktive Check-ins als auch Vorab-Buchungen,
    die diesen Zeitpunkt überschneiden.
    zeitpunkt: 'YYYY-MM-DD HH:MM:SS' oder None (= jetzt)
    """
    if zeitpunkt is None:
        zeitpunkt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_connection()
    count = conn.execute("""
        SELECT COUNT(*) FROM bookings
        WHERE room_id = ?
          AND status IN ('booked', 'checked_in')
          AND start_time <= ?
          AND (
                (end_time IS NOT NULL AND end_time > ?)
             OR (end_time IS NULL AND checkout_at IS NULL)
          )
    """, (room_id, zeitpunkt, zeitpunkt)).fetchone()[0]
    conn.close()
    return count


def is_room_available(room_id, zeitpunkt=None):
    """
    Prüft ob in einem Raum noch Kapazität frei ist – zum gegebenen Zeitpunkt.
    Gibt (verfügbar, freie_plaetze, kapazitaet) zurück.
    """
    conn = get_connection()
    room = conn.execute("SELECT capacity FROM rooms WHERE id = ?",
                        (room_id,)).fetchone()
    conn.close()
    if not room:
        return False, 0, 0
    kapazitaet = room['capacity']
    belegt = get_occupancy_at(room_id, zeitpunkt)
    frei = max(kapazitaet - belegt, 0)
    return frei > 0, frei, kapazitaet


def get_live_occupancy(room_id):
    """
    Live-Belegung JETZT: (belegt, kapazitaet, freie_plaetze).
    Für die Raumanzeige im Web-Interface.
    """
    conn = get_connection()
    room = conn.execute("SELECT capacity FROM rooms WHERE id = ?",
                        (room_id,)).fetchone()
    conn.close()
    if not room:
        return 0, 0, 0
    kapazitaet = room['capacity']
    belegt = get_occupancy_at(room_id)
    frei = max(kapazitaet - belegt, 0)
    return belegt, kapazitaet, frei


# ─────────────────────────────────────────────
#  NUTZER
# ─────────────────────────────────────────────

def add_user(name, email, nfc_uid=None):
    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO users (name, email, nfc_uid) VALUES (?, ?, ?)
        """, (name, email, nfc_uid))
        conn.commit()
        print(f"✓ Nutzer '{name}' hinzugefügt. NFC: {nfc_uid or '–'}")
    except sqlite3.IntegrityError as e:
        print(f"✗ Fehler: {e}")
    finally:
        conn.close()


def assign_nfc_to_user(email, nfc_uid):
    conn = get_connection()
    try:
        cursor = conn.execute(
            "UPDATE users SET nfc_uid = ? WHERE email = ?", (nfc_uid, email))
        if cursor.rowcount == 0:
            print(f"✗ Nutzer '{email}' nicht gefunden.")
        else:
            conn.commit()
            print(f"✓ NFC-UID '{nfc_uid}' → '{email}' zugewiesen.")
    except sqlite3.IntegrityError:
        print(f"✗ Diese NFC-UID ist bereits vergeben.")
    finally:
        conn.close()


def get_user_by_nfc(nfc_uid):
    conn = get_connection()
    user = conn.execute(
        "SELECT * FROM users WHERE nfc_uid = ? AND active = 1",
        (nfc_uid,)).fetchone()
    conn.close()
    return user


def list_users():
    conn = get_connection()
    users = conn.execute("SELECT * FROM users").fetchall()
    conn.close()
    print("\n── Nutzer ─────────────────────────────────────")
    for u in users:
        status = "aktiv" if u['active'] else "inaktiv"
        print(f"  [{u['id']}] {u['name']} | {u['email']} | "
              f"NFC: {u['nfc_uid'] or '–'} | {status}")
    print()
    return users


# ─────────────────────────────────────────────
#  BUCHUNGEN
# ─────────────────────────────────────────────

def add_booking(room_id, user_id, start_time, end_time=None,
                source='web', open_end=False):
    """
    Erstellt eine neue Buchung.
    end_time kann None sein für offene Desksharing-Buchungen.
    Prüft bei Mehpersonen-Räumen die Kapazität statt Zeitkonflikte.
    """
    conn = get_connection()

    # Raum laden
    room = conn.execute("SELECT * FROM rooms WHERE id = ?",
                        (room_id,)).fetchone()
    if not room:
        print(f"✗ Raum {room_id} nicht gefunden.")
        conn.close()
        return None

    # Bei Einzelbüros (capacity=1): normaler Zeitkonflikt-Check
    if room['capacity'] == 1 and end_time:
        conflict = conn.execute("""
            SELECT id FROM bookings
            WHERE room_id = ?
              AND status NOT IN ('cancelled','no_show','completed')
              AND start_time < ?
              AND (end_time > ? OR end_time IS NULL)
        """, (room_id, end_time, start_time)).fetchone()
        if conflict:
            print(f"✗ Buchungskonflikt (Buchung #{conflict['id']}).")
            conn.close()
            return None

    # Bei Mehrpersonen-Räumen: Kapazitätsprüfung
    if room['capacity'] > 1:
        verfuegbar, frei, gesamt = is_room_available(room_id)
        if not verfuegbar:
            print(f"✗ Raum '{room['name']}' ist voll ({gesamt}/{gesamt} Plätze belegt).")
            conn.close()
            return None

    cursor = conn.execute("""
        INSERT INTO bookings
            (room_id, user_id, start_time, end_time, source, open_end)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (room_id, user_id, start_time, end_time, source,
          1 if open_end else 0))
    conn.commit()
    booking_id = cursor.lastrowid
    conn.close()
    print(f"✓ Buchung #{booking_id} erstellt "
          f"({'offen' if open_end else end_time}).")
    return booking_id


def find_active_booking(user_id, room_id):
    """Aktive Vorab-Buchung (booked) für jetzt."""
    conn = get_connection()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    booking = conn.execute("""
        SELECT * FROM bookings
        WHERE user_id = ?
          AND room_id = ?
          AND status = 'booked'
          AND start_time <= ?
          AND (end_time >= ? OR end_time IS NULL)
    """, (user_id, room_id, now, now)).fetchone()
    conn.close()
    return booking


def find_current_checkin(user_id, room_id):
    """Prüft ob Nutzer gerade in diesem Raum eingecheckt ist."""
    conn = get_connection()
    booking = conn.execute("""
        SELECT * FROM bookings
        WHERE user_id = ?
          AND room_id = ?
          AND status = 'checked_in'
          AND checkout_at IS NULL
    """, (user_id, room_id)).fetchone()
    conn.close()
    return booking


def checkin_booking(booking_id):
    """Check-in: Status → checked_in, checkin_at setzen."""
    conn = get_connection()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("""
        UPDATE bookings
        SET status = 'checked_in', checkin_at = ?
        WHERE id = ?
    """, (now, booking_id))
    conn.commit()
    conn.close()
    print(f"✓ Check-in Buchung #{booking_id} um {now}.")


def checkout_booking(booking_id):
    """
    Check-out: Status → completed, checkout_at + end_time setzen.
    Gibt die Dauer in Minuten zurück.
    """
    conn = get_connection()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    booking = conn.execute(
        "SELECT checkin_at FROM bookings WHERE id = ?",
        (booking_id,)).fetchone()

    dauer_min = None
    if booking and booking['checkin_at']:
        checkin = datetime.strptime(booking['checkin_at'], "%Y-%m-%d %H:%M:%S")
        checkout = datetime.strptime(now, "%Y-%m-%d %H:%M:%S")
        dauer_min = int((checkout - checkin).total_seconds() / 60)

    conn.execute("""
        UPDATE bookings
        SET status = 'completed',
            checkout_at = ?,
            end_time = COALESCE(end_time, ?)
        WHERE id = ?
    """, (now, now, booking_id))
    conn.commit()
    conn.close()
    print(f"✓ Check-out Buchung #{booking_id} um {now} "
          f"({dauer_min} Min)." if dauer_min else
          f"✓ Check-out Buchung #{booking_id}.")
    return dauer_min


def create_walkin_booking(user_id, room_id):
    """
    Erstellt eine Walk-In Buchung (ohne Vorab-Buchung per NFC).
    Startzeit = jetzt, kein festes Ende (open_end).
    """
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    booking_id = add_booking(
        room_id=room_id,
        user_id=user_id,
        start_time=now,
        end_time=None,
        source='walkin',
        open_end=True
    )
    return booking_id


def cleanup_expired_bookings():
    """Abgelaufene Buchungen auf 'completed' setzen."""
    conn = get_connection()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor = conn.execute("""
        UPDATE bookings
        SET status = 'completed'
        WHERE end_time < ?
          AND end_time IS NOT NULL
          AND status IN ('booked','checked_in')
    """, (now,))
    count = cursor.rowcount
    conn.commit()
    conn.close()
    if count > 0:
        print(f"✓ {count} abgelaufene Buchung(en) abgeschlossen.")


def list_bookings():
    conn = get_connection()
    bookings = conn.execute("""
        SELECT b.id, u.name as nutzer, r.name as raum,
               b.start_time, b.end_time, b.status,
               b.source, b.checkin_at, b.checkout_at, b.open_end
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        JOIN rooms r ON b.room_id = r.id
        ORDER BY b.start_time DESC
    """).fetchall()
    conn.close()
    print("\n── Buchungen ──────────────────────────────────")
    for b in bookings:
        ende = "offen" if b['open_end'] and not b['end_time'] else \
               (b['end_time'][11:16] if b['end_time'] else "–")
        print(f"  [{b['id']}] {b['nutzer']:<20} → {b['raum']:<22} | "
              f"{b['start_time'][11:16]}–{ende} | "
              f"{b['status']:<10} | {b['source']}")
    print()
    return bookings


# ─────────────────────────────────────────────
#  TESTDATEN
# ─────────────────────────────────────────────

def insert_test_data():
    print("\n── Testdaten einfügen ─────────────────────────")

    # Einzelbüro (normales Meeting-Zimmer, 1 Gruppe)
    add_room("Besprechungsraum A", "meeting", capacity=1,
             nfc_reader_id="READER_001",
             description="Kleines Meeting-Zimmer, 1 Gruppe",
             allow_walkin=False)

    # Desksharing-Raum mit 4 Plätzen
    add_room("Desksharing Raum Groß", "desk", capacity=4,
             nfc_reader_id="READER_002",
             description="Offener Arbeitsbereich, 4 Plätze",
             allow_walkin=True)

    # Desksharing-Raum mit 2 Plätzen
    add_room("Desksharing Raum Klein", "desk", capacity=2,
             nfc_reader_id="READER_003",
             description="Ruhiger Arbeitsbereich, 2 Plätze",
             allow_walkin=True)

    # Nutzer
    add_user("Berta Langenhahn",   "berta@beispiel.de",  nfc_uid="A8F977E7")
    add_user("Familienvater Mayer", "mayer@beispiel.de",  nfc_uid="B81DEBEF")
    add_user("Dion Müller",         "dion@beispiel.de",   nfc_uid="B8AED9EF")
    add_user("Luca Guinness",        "luca@beispiel.de",   nfc_uid="B851FBE7")
    add_user("Eric Nicefield",       "eric@beispiel.de",   nfc_uid="B8F3F9EF")

    # Vorab-Buchung für Besprechungsraum (Meeting)
    jetzt = datetime.now()
    add_booking(room_id=1, user_id=1,
                start_time=jetzt.strftime("%Y-%m-%d %H:%M"),
                end_time=(jetzt + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M"),
                source='web')


# ─────────────────────────────────────────────
#  HAUPTPROGRAMM
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Raumbuchungssystem – Datenbank Setup ===\n")
    init_db()
    insert_test_data()
    print("\n── Übersicht ──────────────────────────────────")
    list_rooms()
    list_users()
    list_bookings()
    print("=== Setup abgeschlossen ===")
