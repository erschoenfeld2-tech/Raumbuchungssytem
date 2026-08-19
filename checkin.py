"""
Raumbuchungssystem – Multi-Reader Check-in/out via NFC
=======================================================
Überwacht ALLE angeschlossenen NFC-Reader gleichzeitig.
Jeder Reader ist über reader_config.py fest einem Raum zugeordnet.

Vollautomatisch:
  - Karte identifiziert die Person (UID → Nutzer aus DB)
  - Reader identifiziert den Raum (Reader-Name → room_id)
  - Keine Eingabe nötig, keine Weboberfläche

Ablauf pro Karte:
  1. Nutzer bereits eingecheckt?  → Check-OUT
  2. Aktive Vorab-Buchung?        → Check-IN
  3. Walk-In erlaubt + Platz frei? → Walk-In Buchung + Check-IN
  4. Sonst                        → Ablehnen (rote LED)

Nutzung:
    py checkin.py
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


# ── NFC-Kommandos ──────────────────────────────────────────

def read_uid(connection):
    GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
    response, sw1, sw2 = connection.transmit(GET_UID)
    if sw1 == 0x90 and sw2 == 0x00:
        return toHexString(response).replace(" ", "")
    raise CardConnectionException(f"Lesefehler: SW1={sw1:02X} SW2={sw2:02X}")


def led_green(connection):
    try:
        connection.transmit([0xFF, 0x00, 0x40, 0x0E, 0x04,
                             0x01, 0x01, 0x01, 0x01])
    except Exception:
        pass


def led_red(connection):
    try:
        connection.transmit([0xFF, 0x00, 0x40, 0x05, 0x04,
                             0x02, 0x02, 0x02, 0x02])
    except Exception:
        pass


# ── Hilfsfunktionen ────────────────────────────────────────

def get_room_info(room_id):
    conn = get_connection()
    room = conn.execute("SELECT * FROM rooms WHERE id = ?",
                        (room_id,)).fetchone()
    conn.close()
    return room


def raum_fuer_reader(reader_name):
    """Ermittelt die Raum-ID für einen Reader-Namen."""
    # Exakte Übereinstimmung
    if reader_name in READER_ZU_RAUM:
        return READER_ZU_RAUM[reader_name]
    # Teilweise Übereinstimmung (falls Windows Zusätze anhängt)
    for name, room_id in READER_ZU_RAUM.items():
        if name in reader_name or reader_name in name:
            return room_id
    return STANDARD_RAUM


# ── Kernlogik ──────────────────────────────────────────────

def process_card(uid, room_id, connection, reader_name):
    """Verarbeitet eine aufgelegte Karte an einem bestimmten Raum."""
    room = get_room_info(room_id)
    if not room:
        print(f"  [{reader_name}] ✗ Raum {room_id} nicht gefunden.")
        led_red(connection)
        return

    print(f"\n  [{room['name']}] 📡 Karte: {uid}")

    # Schritt 1: Nutzer identifizieren
    user = get_user_by_nfc(uid)
    if not user:
        print(f"  [{room['name']}] ✗ Unbekannte Karte – nicht registriert.")
        led_red(connection)
        return

    print(f"  [{room['name']}] 👤 {user['name']}")

    verfuegbar, frei, gesamt = is_room_available(room_id)

    # Schritt 2: Bereits eingecheckt? → CHECK-OUT
    current = find_current_checkin(user['id'], room_id)
    if current:
        dauer = checkout_booking(current['id'])
        dauer_text = f"{dauer} Min" if dauer else ""
        print(f"  [{room['name']}] 🔴 CHECK-OUT – {user['name']} | {dauer_text}")
        print(f"  [{room['name']}]    Plätze jetzt: {frei + 1}/{gesamt} frei")
        led_green(connection)
        return

    # Schritt 3: Vorab-Buchung? → CHECK-IN
    booking = find_active_booking(user['id'], room_id)
    if booking:
        checkin_booking(booking['id'])
        ende = booking['end_time'][11:16] if booking['end_time'] else 'offen'
        print(f"  [{room['name']}] 🟢 CHECK-IN (Vorab #{booking['id']}) "
              f"bis {ende}")
        print(f"  [{room['name']}]    Plätze: {max(frei-1,0)}/{gesamt} frei")
        led_green(connection)
        return

    # Schritt 4: Walk-In
    if not room['allow_walkin']:
        print(f"  [{room['name']}] ✗ Kein Walk-In – Vorab-Buchung nötig.")
        led_red(connection)
        return

    if not verfuegbar:
        print(f"  [{room['name']}] ✗ Raum voll ({gesamt}/{gesamt} belegt).")
        led_red(connection)
        return

    booking_id = create_walkin_booking(user['id'], room_id)
    if not booking_id:
        print(f"  [{room['name']}] ✗ Walk-In fehlgeschlagen.")
        led_red(connection)
        return

    checkin_booking(booking_id)
    print(f"  [{room['name']}] 🟢 WALK-IN CHECK-IN – {user['name']}")
    print(f"  [{room['name']}]    Buchung #{booking_id} | Karte nochmal = Check-out")
    print(f"  [{room['name']}]    Plätze: {max(frei-1,0)}/{gesamt} frei")
    led_green(connection)


# ── Multi-Reader Überwachung ───────────────────────────────

def main():
    alle_reader = readers()
    if not alle_reader:
        raise RuntimeError("Keine NFC-Reader gefunden. USB-Verbindung prüfen.")

    cleanup_expired_bookings()

    # Reader ihren Räumen zuordnen
    aktive_reader = []
    print(f"\n{'='*55}")
    print(f"  Raumbuchungssystem – Multi-Reader Check-in")
    print(f"{'='*55}")

    for reader in alle_reader:
        reader_name = str(reader)
        room_id = raum_fuer_reader(reader_name)
        if room_id is None:
            print(f"  ⚠  {reader_name} → keinem Raum zugeordnet (ignoriert)")
            continue
        room = get_room_info(room_id)
        if room:
            frei_info = is_room_available(room_id)
            aktive_reader.append((reader, reader_name, room_id, room['name']))
            print(f"  ✓ {reader_name}")
            print(f"      → {room['name']} (Kap:{room['capacity']}, "
                  f"{frei_info[1]}/{frei_info[2]} frei)")

    if not aktive_reader:
        raise RuntimeError("Kein Reader konnte einem Raum zugeordnet werden. "
                          "Prüfe reader_config.py.")

    print(f"{'='*55}")
    print(f"  {len(aktive_reader)} Reader aktiv. Karte auflegen zum Ein-/Auschecken.")
    print(f"  Strg+C zum Beenden.")
    print(f"{'='*55}")

    # Status pro Reader: welche UID liegt gerade auf?
    last_uids = {name: None for _, name, _, _ in aktive_reader}

    while True:
        for reader, reader_name, room_id, room_name in aktive_reader:
            try:
                connection = reader.createConnection()
                connection.connect()
                uid = read_uid(connection)

                # Karte nur einmal pro Auflegen verarbeiten
                if uid != last_uids[reader_name]:
                    process_card(uid, room_id, connection, reader_name)
                    last_uids[reader_name] = uid

            except NoCardException:
                if last_uids[reader_name] is not None:
                    last_uids[reader_name] = None
            except CardConnectionException:
                pass
            except Exception:
                pass

        time.sleep(0.4)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nSystem beendet.")
    except RuntimeError as e:
        print(f"\nFehler: {e}")
