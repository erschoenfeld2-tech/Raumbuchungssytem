"""
Raumbuchungssystem – DEBUG Check-in
====================================
Diagnose-Version die JEDEN Schritt sichtbar macht.
Zeigt genau wo es hakt: UID-Lesung, Nutzer-Suche, Buchung.

Nutzung:
    py checkin_debug.py

Diese Version bucht auch echt – aber mit voller Ausgabe zur Fehlersuche.
"""

from smartcard.System import readers
from smartcard.util import toHexString
from smartcard.Exceptions import NoCardException, CardConnectionException
import time

from database import (
    get_user_by_nfc, find_active_booking, find_current_checkin,
    checkin_booking, checkout_booking, create_walkin_booking,
    is_room_available, cleanup_expired_bookings, get_connection
)
from reader_config import READER_ZU_RAUM, STANDARD_RAUM


def read_uid(connection):
    GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
    response, sw1, sw2 = connection.transmit(GET_UID)
    if sw1 == 0x90 and sw2 == 0x00:
        return toHexString(response).replace(" ", "")
    raise CardConnectionException(f"Lesefehler: SW1={sw1:02X} SW2={sw2:02X}")


def led_green(connection):
    try:
        connection.transmit([0xFF, 0x00, 0x40, 0x0E, 0x04, 0x01, 0x01, 0x01, 0x01])
    except Exception:
        pass


def led_red(connection):
    try:
        connection.transmit([0xFF, 0x00, 0x40, 0x05, 0x04, 0x02, 0x02, 0x02, 0x02])
    except Exception:
        pass


def raum_fuer_reader(reader_name):
    if reader_name in READER_ZU_RAUM:
        return READER_ZU_RAUM[reader_name]
    for name, room_id in READER_ZU_RAUM.items():
        if name in reader_name or reader_name in name:
            return room_id
    return STANDARD_RAUM


def zeige_alle_uids():
    """Zeigt alle in der DB gespeicherten UIDs zum Vergleich."""
    conn = get_connection()
    users = conn.execute(
        "SELECT name, nfc_uid FROM users WHERE nfc_uid IS NOT NULL").fetchall()
    conn.close()
    print("\n  ── In der Datenbank gespeicherte UIDs ──")
    for u in users:
        print(f"     '{u['nfc_uid']}'  →  {u['name']}")
    print("  ────────────────────────────────────────\n")


def process_card_debug(uid, room_id, connection, reader_name):
    print(f"\n  {'='*50}")
    print(f"  SCHRITT 1 – Karte gelesen")
    print(f"    Reader:    '{reader_name}'")
    print(f"    Raum-ID:   {room_id}")
    print(f"    UID (roh): '{uid}'")
    print(f"    UID Länge: {len(uid)} Zeichen")

    # Nutzer suchen
    print(f"\n  SCHRITT 2 – Nutzer in Datenbank suchen")
    user = get_user_by_nfc(uid)

    if not user:
        print(f"    ✗ KEIN Nutzer mit UID '{uid}' gefunden!")
        print(f"    → Das ist wahrscheinlich das Problem.")
        # Versuche Varianten
        print(f"\n  SCHRITT 2b – Teste UID-Varianten:")
        varianten = {
            "lowercase": uid.lower(),
            "uppercase": uid.upper(),
            "mit Leerzeichen": " ".join(uid[i:i+2] for i in range(0, len(uid), 2)),
        }
        conn = get_connection()
        for label, variante in varianten.items():
            treffer = conn.execute(
                "SELECT name FROM users WHERE nfc_uid = ? OR UPPER(nfc_uid) = ? OR LOWER(nfc_uid) = ?",
                (variante, variante.upper(), variante.lower())).fetchone()
            status = f"→ TREFFER: {treffer['name']}" if treffer else "→ kein Treffer"
            print(f"      {label:20s}: '{variante}'  {status}")
        conn.close()
        zeige_alle_uids()
        led_red(connection)
        return

    print(f"    ✓ Nutzer gefunden: {user['name']} ({user['email']})")

    verfuegbar, frei, gesamt = is_room_available(room_id)
    print(f"\n  SCHRITT 3 – Raum-Status")
    print(f"    Verfügbar: {verfuegbar} | Frei: {frei}/{gesamt}")

    # Check-out?
    current = find_current_checkin(user['id'], room_id)
    if current:
        print(f"\n  SCHRITT 4 – CHECK-OUT (war eingecheckt)")
        dauer = checkout_booking(current['id'])
        print(f"    ✓ Ausgecheckt nach {dauer} Min")
        led_green(connection)
        return

    # Vorab-Buchung?
    booking = find_active_booking(user['id'], room_id)
    if booking:
        print(f"\n  SCHRITT 4 – CHECK-IN (Vorab-Buchung #{booking['id']})")
        checkin_booking(booking['id'])
        print(f"    ✓ Eingecheckt")
        led_green(connection)
        return

    # Walk-In?
    print(f"\n  SCHRITT 4 – Walk-In Versuch")
    conn = get_connection()
    room = conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
    conn.close()
    print(f"    Walk-In erlaubt: {bool(room['allow_walkin'])}")

    if not room['allow_walkin']:
        print(f"    ✗ Raum erlaubt keinen Walk-In")
        led_red(connection)
        return
    if not verfuegbar:
        print(f"    ✗ Raum voll")
        led_red(connection)
        return

    booking_id = create_walkin_booking(user['id'], room_id)
    print(f"    create_walkin_booking → Buchung-ID: {booking_id}")
    if booking_id:
        checkin_booking(booking_id)
        print(f"    ✓ WALK-IN ERFOLGREICH – Buchung #{booking_id} erstellt & eingecheckt")
        print(f"    → Sollte jetzt auf der Webseite erscheinen!")
        led_green(connection)
    else:
        print(f"    ✗ Walk-In Buchung fehlgeschlagen (booking_id ist None)")
        led_red(connection)


def main():
    alle_reader = readers()
    if not alle_reader:
        raise RuntimeError("Keine NFC-Reader gefunden.")

    cleanup_expired_bookings()

    print(f"\n{'='*52}")
    print(f"  DEBUG Check-in – zeigt jeden Schritt")
    print(f"{'='*52}")

    zeige_alle_uids()

    aktive_reader = []
    for reader in alle_reader:
        reader_name = str(reader)
        room_id = raum_fuer_reader(reader_name)
        print(f"  Reader '{reader_name}' → Raum {room_id}")
        if room_id is not None:
            aktive_reader.append((reader, reader_name, room_id))

    if not aktive_reader:
        raise RuntimeError("Kein Reader zugeordnet. Prüfe reader_config.py.")

    print(f"\n  {len(aktive_reader)} Reader aktiv. Karte auflegen...")
    print(f"  Strg+C zum Beenden.\n")

    last_uids = {name: None for _, name, _ in aktive_reader}

    while True:
        for reader, reader_name, room_id in aktive_reader:
            try:
                connection = reader.createConnection()
                connection.connect()
                uid = read_uid(connection)
                if uid != last_uids[reader_name]:
                    process_card_debug(uid, room_id, connection, reader_name)
                    last_uids[reader_name] = uid
            except NoCardException:
                if last_uids[reader_name] is not None:
                    last_uids[reader_name] = None
            except CardConnectionException as e:
                pass
            except Exception as e:
                print(f"  ⚠ Fehler bei {reader_name}: {e}")
        time.sleep(0.4)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nBeendet.")
    except RuntimeError as e:
        print(f"\nFehler: {e}")
