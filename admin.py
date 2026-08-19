"""
Raumbuchungssystem – Admin-Panel
=================================
Kommandozeilen-Tool zum Verwalten von Nutzern, NFC-Karten und Räumen.

Nutzung:
    py admin.py

Voraussetzung:
    - database.py liegt im selben Ordner
    - raumbuchung.db existiert (py database.py einmal ausführen)
"""

from database import (
    add_user, assign_nfc_to_user, list_users,
    add_room, list_rooms, get_connection
)
from datetime import datetime


# ── Farben für die Kommandozeile ───────────────────────────
class C:
    HEADER  = '\033[95m'
    BLUE    = '\033[94m'
    CYAN    = '\033[96m'
    GREEN   = '\033[92m'
    AMBER   = '\033[93m'
    RED     = '\033[91m'
    BOLD    = '\033[1m'
    RESET   = '\033[0m'

def gruen(text):  return f"{C.GREEN}{text}{C.RESET}"
def rot(text):    return f"{C.RED}{text}{C.RESET}"
def cyan(text):   return f"{C.CYAN}{text}{C.RESET}"
def fett(text):   return f"{C.BOLD}{text}{C.RESET}"
def amber(text):  return f"{C.AMBER}{text}{C.RESET}"


# ── Hilfsfunktionen ────────────────────────────────────────

def trennlinie(char="─", breite=52):
    print(cyan(char * breite))

def eingabe(prompt, pflicht=True):
    """Eingabe mit optionaler Pflichtfeld-Prüfung."""
    while True:
        wert = input(f"  {prompt}: ").strip()
        if wert or not pflicht:
            return wert
        print(rot("  ✗ Dieses Feld darf nicht leer sein."))

def bestaetigung(frage):
    """Ja/Nein Bestätigung."""
    antwort = input(f"  {amber('⚠')}  {frage} (j/n): ").strip().lower()
    return antwort in ("j", "ja", "y", "yes")


# ── Nutzer-Funktionen ──────────────────────────────────────

def nutzer_anlegen():
    """Neuen Nutzer anlegen."""
    print(f"\n{fett('── Neuen Nutzer anlegen ──────────────────────')}")
    name  = eingabe("Name (Vor- und Nachname)")
    email = eingabe("E-Mail-Adresse")

    print(f"\n  {amber('NFC-Karte zuweisen?')}")
    print("  Lasse das Feld leer wenn die Karte später zugewiesen wird.")
    uid = eingabe("NFC-Karten-UID (optional)", pflicht=False)

    print()
    add_user(name, email, nfc_uid=uid if uid else None)


def nfc_karte_zuweisen():
    """NFC-Karte einem bestehenden Nutzer zuweisen."""
    print(f"\n{fett('── NFC-Karte zuweisen ────────────────────────')}")
    print("  Aktuelle Nutzer:")
    list_users()

    email = eingabe("E-Mail-Adresse des Nutzers")
    uid   = eingabe("NFC-Karten-UID (z.B. 6DF72C5E)")

    print()
    assign_nfc_to_user(email, uid)


def nutzer_deaktivieren():
    """Nutzer deaktivieren – Karte wird gesperrt, Daten bleiben erhalten."""
    print(f"\n{fett('── Nutzer deaktivieren ───────────────────────')}")
    print("  Aktuelle Nutzer:")
    list_users()

    email = eingabe("E-Mail-Adresse des zu deaktivierenden Nutzers")

    # Nutzer suchen
    conn = get_connection()
    nutzer = conn.execute(
        "SELECT id, name FROM users WHERE email = ?", (email,)
    ).fetchone()

    if not nutzer:
        print(rot(f"  ✗ Kein Nutzer mit E-Mail '{email}' gefunden."))
        conn.close()
        return

    print(f"\n  Nutzer gefunden: {fett(nutzer['name'])}")
    if not bestaetigung(f"Nutzer '{nutzer['name']}' wirklich deaktivieren?"):
        print(amber("  Abgebrochen."))
        conn.close()
        return

    conn.execute("UPDATE users SET active = 0 WHERE email = ?", (email,))
    conn.commit()
    conn.close()
    print(gruen(f"  ✓ Nutzer '{nutzer['name']}' wurde deaktiviert. Karte ist gesperrt."))


def nutzer_reaktivieren():
    """Deaktivierten Nutzer wieder aktivieren."""
    print(f"\n{fett('── Nutzer reaktivieren ───────────────────────')}")

    conn = get_connection()
    inaktive = conn.execute(
        "SELECT id, name, email, nfc_uid FROM users WHERE active = 0"
    ).fetchall()

    if not inaktive:
        print(amber("  Keine deaktivierten Nutzer vorhanden."))
        conn.close()
        return

    print("  Deaktivierte Nutzer:")
    for u in inaktive:
        print(f"    [{u['id']}] {u['name']} | {u['email']} | NFC: {u['nfc_uid'] or 'keine'}")

    email = eingabe("\nE-Mail-Adresse des zu reaktivierenden Nutzers")
    conn.execute("UPDATE users SET active = 1 WHERE email = ?", (email,))
    conn.commit()
    conn.close()
    print(gruen(f"  ✓ Nutzer '{email}' wurde reaktiviert."))


def nfc_karte_entfernen():
    """NFC-Karte von einem Nutzer entfernen (z.B. bei Kartenverlust)."""
    print(f"\n{fett('── NFC-Karte entfernen ───────────────────────')}")
    print("  Aktuelle Nutzer:")
    list_users()

    email = eingabe("E-Mail-Adresse des Nutzers")

    conn = get_connection()
    nutzer = conn.execute(
        "SELECT name, nfc_uid FROM users WHERE email = ?", (email,)
    ).fetchone()

    if not nutzer:
        print(rot(f"  ✗ Kein Nutzer mit E-Mail '{email}' gefunden."))
        conn.close()
        return

    if not nutzer['nfc_uid']:
        print(amber(f"  Nutzer '{nutzer['name']}' hat keine NFC-Karte zugewiesen."))
        conn.close()
        return

    print(f"\n  Aktuelle UID: {fett(nutzer['nfc_uid'])}")
    if not bestaetigung(f"NFC-Karte von '{nutzer['name']}' wirklich entfernen?"):
        print(amber("  Abgebrochen."))
        conn.close()
        return

    conn.execute("UPDATE users SET nfc_uid = NULL WHERE email = ?", (email,))
    conn.commit()
    conn.close()
    print(gruen(f"  ✓ NFC-Karte wurde von '{nutzer['name']}' entfernt."))


def buchungen_nutzer():
    """Alle Buchungen eines bestimmten Nutzers anzeigen."""
    print(f"\n{fett('── Buchungen eines Nutzers ───────────────────')}")
    print("  Aktuelle Nutzer:")
    list_users()

    email = eingabe("E-Mail-Adresse des Nutzers")

    conn = get_connection()
    buchungen = conn.execute("""
        SELECT b.id, r.name as raum, b.start_time, b.end_time,
               b.status, b.checkin_at
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN users u ON b.user_id = u.id
        WHERE u.email = ?
        ORDER BY b.start_time DESC
        LIMIT 20
    """, (email,)).fetchall()
    conn.close()

    if not buchungen:
        print(amber(f"  Keine Buchungen für '{email}' gefunden."))
        return

    print(f"\n  Letzte Buchungen für {cyan(email)}:")
    trennlinie()
    for b in buchungen:
        status_farbe = gruen if b['status'] == 'checked_in' else (
                       rot   if b['status'] in ('cancelled','no_show') else
                       amber if b['status'] == 'completed' else str)
        checkin_info = f" | Check-in: {b['checkin_at']}" if b['checkin_at'] else ""
        print(f"  [{b['id']}] {b['raum']} | "
              f"{b['start_time'][:16]} – {b['end_time'][11:16]} | "
              f"{status_farbe(b['status'])}{checkin_info}")
    trennlinie()


def buchung_stornieren():
    """Eine bestimmte Buchung stornieren."""
    print(f"\n{fett('── Buchung stornieren ────────────────────────')}")

    buchung_id = eingabe("Buchungs-ID (aus der Liste oben)")

    conn = get_connection()
    buchung = conn.execute("""
        SELECT b.id, u.name, r.name as raum, b.start_time, b.end_time, b.status
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.id = ?
    """, (buchung_id,)).fetchone()

    if not buchung:
        print(rot(f"  ✗ Buchung #{buchung_id} nicht gefunden."))
        conn.close()
        return

    if buchung['status'] not in ('booked', 'checked_in'):
        print(amber(f"  Buchung ist bereits '{buchung['status']}' – kann nicht storniert werden."))
        conn.close()
        return

    print(f"\n  {buchung['raum']} | {buchung['name']} | "
          f"{buchung['start_time'][:16]} – {buchung['end_time'][11:16]}")

    if not bestaetigung("Buchung wirklich stornieren?"):
        print(amber("  Abgebrochen."))
        conn.close()
        return

    conn.execute("UPDATE bookings SET status = 'cancelled' WHERE id = ?", (buchung_id,))
    conn.commit()
    conn.close()
    print(gruen(f"  ✓ Buchung #{buchung_id} wurde storniert."))


# ── Raum-Funktionen ────────────────────────────────────────

def raum_hinzufuegen():
    """Neuen Raum oder Desk hinzufügen."""
    print(f"\n{fett('── Neuen Raum hinzufügen ─────────────────────')}")
    name = eingabe("Name des Raums (z.B. 'Besprechungsraum B')")

    print("  Typ:")
    print("    1 – Besprechungsraum (meeting)")
    print("    2 – Schreibtisch / Desk (desk)")
    typ_wahl = eingabe("Auswahl (1 oder 2)")
    raum_typ = "meeting" if typ_wahl == "1" else "desk"

    kapazitaet = eingabe("Kapazität (Anzahl Personen, z.B. 4)", pflicht=False) or "1"
    reader_id  = eingabe("NFC-Reader-ID (optional, z.B. READER_004)", pflicht=False)
    beschreibung = eingabe("Beschreibung (optional)", pflicht=False)

    print()
    add_room(
        name, raum_typ,
        capacity=int(kapazitaet),
        nfc_reader_id=reader_id if reader_id else None,
        description=beschreibung if beschreibung else None
    )


def raum_deaktivieren():
    """Raum aus dem aktiven Betrieb nehmen."""
    print(f"\n{fett('── Raum deaktivieren ─────────────────────────')}")
    list_rooms()

    raum_id = eingabe("Raum-ID")

    conn = get_connection()
    raum = conn.execute("SELECT name FROM rooms WHERE id = ?", (raum_id,)).fetchone()

    if not raum:
        print(rot(f"  ✗ Raum #{raum_id} nicht gefunden."))
        conn.close()
        return

    if not bestaetigung(f"Raum '{raum['name']}' wirklich deaktivieren?"):
        print(amber("  Abgebrochen."))
        conn.close()
        return

    # Offene Buchungen stornieren
    conn.execute("""
        UPDATE bookings SET status = 'cancelled'
        WHERE room_id = ? AND status = 'booked'
    """, (raum_id,))
    conn.commit()
    conn.close()
    print(gruen(f"  ✓ Raum '{raum['name']}' deaktiviert. Offene Buchungen wurden storniert."))


# ── Übersichten ────────────────────────────────────────────

def alle_buchungen_heute():
    """Alle heutigen Buchungen anzeigen."""
    heute = datetime.now().strftime("%Y-%m-%d")
    conn  = get_connection()
    buchungen = conn.execute("""
        SELECT b.id, u.name as nutzer, r.name as raum,
               b.start_time, b.end_time, b.status
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        JOIN rooms r ON b.room_id = r.id
        WHERE DATE(b.start_time) = ?
          AND b.status NOT IN ('cancelled')
        ORDER BY b.start_time
    """, (heute,)).fetchall()
    conn.close()

    print(f"\n{fett(f'── Buchungen heute ({heute}) ─────────────')}")
    if not buchungen:
        print(amber("  Keine Buchungen für heute."))
        return

    trennlinie()
    for b in buchungen:
        status_farbe = (gruen  if b['status'] == 'checked_in' else
                        amber  if b['status'] == 'completed'  else str)
        print(f"  {b['start_time'][11:16]}–{b['end_time'][11:16]} | "
              f"{b['raum']:<22} | {b['nutzer']:<20} | "
              f"{status_farbe(b['status'])}")
    trennlinie()


def statistik():
    """Einfache Nutzungsstatistik anzeigen."""
    conn = get_connection()
    print(f"\n{fett('── Statistik ─────────────────────────────────')}")
    trennlinie()

    gesamt     = conn.execute("SELECT COUNT(*) FROM bookings").fetchone()[0]
    checkins   = conn.execute("SELECT COUNT(*) FROM bookings WHERE status = 'checked_in' OR checkin_at IS NOT NULL").fetchone()[0]
    no_shows   = conn.execute("SELECT COUNT(*) FROM bookings WHERE status = 'no_show'").fetchone()[0]
    nutzer     = conn.execute("SELECT COUNT(*) FROM users WHERE active = 1").fetchone()[0]
    mit_karte  = conn.execute("SELECT COUNT(*) FROM users WHERE nfc_uid IS NOT NULL AND active = 1").fetchone()[0]
    raeume     = conn.execute("SELECT COUNT(*) FROM rooms").fetchone()[0]
    conn.close()

    print(f"  Buchungen gesamt:      {fett(str(gesamt))}")
    print(f"  Davon eingecheckt:     {gruen(str(checkins))}")
    print(f"  No-Shows:              {rot(str(no_shows))}")
    print(f"  Aktive Nutzer:         {fett(str(nutzer))} ({mit_karte} mit NFC-Karte)")
    print(f"  Räume im System:       {fett(str(raeume))}")
    trennlinie()


# ── Hauptmenü ──────────────────────────────────────────────

def menu():
    while True:
        print(f"\n{cyan('╔══════════════════════════════════════════════╗')}")
        print(f"{cyan('║')}  {fett('Raumbuchungssystem – Admin-Panel')}          {cyan('║')}")
        print(f"{cyan('╚══════════════════════════════════════════════╝')}")

        print(f"\n  {fett('── Nutzer ──────────────────────────────────')}")
        print("   1  Neuen Nutzer anlegen")
        print("   2  NFC-Karte zuweisen")
        print("   3  NFC-Karte entfernen (bei Verlust)")
        print("   4  Nutzer deaktivieren")
        print("   5  Nutzer reaktivieren")
        print("   6  Alle Nutzer anzeigen")
        print("   7  Buchungen eines Nutzers anzeigen")
        print("   8  Buchung stornieren")

        print(f"\n  {fett('── Räume ───────────────────────────────────')}")
        print("   9  Neuen Raum / Desk hinzufügen")
        print("  10  Alle Räume anzeigen")
        print("  11  Raum deaktivieren")

        print(f"\n  {fett('── Übersicht ───────────────────────────────')}")
        print("  12  Buchungen heute anzeigen")
        print("  13  Statistik")

        print(f"\n   {rot('0  Beenden')}")
        trennlinie()

        wahl = input("  Auswahl: ").strip()

        aktionen = {
            "1":  nutzer_anlegen,
            "2":  nfc_karte_zuweisen,
            "3":  nfc_karte_entfernen,
            "4":  nutzer_deaktivieren,
            "5":  nutzer_reaktivieren,
            "6":  list_users,
            "7":  buchungen_nutzer,
            "8":  buchung_stornieren,
            "9":  raum_hinzufuegen,
            "10": list_rooms,
            "11": raum_deaktivieren,
            "12": alle_buchungen_heute,
            "13": statistik,
            "0":  None
        }

        if wahl == "0":
            print(gruen("\n  Auf Wiedersehen! 👋\n"))
            break
        elif wahl in aktionen:
            try:
                aktionen[wahl]()
            except KeyboardInterrupt:
                print(amber("\n  Abgebrochen."))
            except Exception as e:
                print(rot(f"\n  ✗ Fehler: {e}"))
        else:
            print(rot("  ✗ Ungültige Eingabe. Bitte eine Zahl aus dem Menü eingeben."))

        input(f"\n  {amber('Enter drücken um fortzufahren...')}")


# ── Start ──────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        menu()
    except KeyboardInterrupt:
        print(gruen("\n\n  Auf Wiedersehen! 👋\n"))
