"""
Raumbuchungssystem – Demo / Lokale Simulation (erweitert)
=========================================================
Simuliert das komplette System lokal in der Konsole –
inkl. Walk-In, Kapazitätsprüfung und Check-out.

Nutzung:
    py demo.py
"""

from database import (
    get_connection, add_booking, list_rooms, list_users,
    find_active_booking, find_current_checkin,
    checkin_booking, checkout_booking, create_walkin_booking,
    is_room_available, cleanup_expired_bookings, get_user_by_nfc
)
from datetime import datetime, timedelta
import time


# ── Farben ─────────────────────────────────────────────────
class C:
    GREEN  = '\033[92m'
    AMBER  = '\033[93m'
    RED    = '\033[91m'
    CYAN   = '\033[96m'
    BOLD   = '\033[1m'
    MUTED  = '\033[2m'
    RESET  = '\033[0m'

def gruen(t):  return f"{C.GREEN}{t}{C.RESET}"
def rot(t):    return f"{C.RED}{t}{C.RESET}"
def cyan(t):   return f"{C.CYAN}{t}{C.RESET}"
def fett(t):   return f"{C.BOLD}{t}{C.RESET}"
def amber(t):  return f"{C.AMBER}{t}{C.RESET}"
def muted(t):  return f"{C.MUTED}{t}{C.RESET}"

def trennlinie(titel="", breite=60):
    if titel:
        s = (breite - len(titel) - 2) // 2
        print(cyan("─" * s) + f" {fett(titel)} " + cyan("─" * s))
    else:
        print(cyan("─" * breite))

def eingabe(prompt, pflicht=True):
    while True:
        w = input(f"  {prompt}: ").strip()
        if w or not pflicht:
            return w
        print(rot("  ✗ Pflichtfeld."))

def weiter():
    input(f"\n  {muted('Enter drücken...')}")


# ── Simulierte API-Funktionen ──────────────────────────────

def api_get_rooms():
    """→ GET /api/raeume"""
    conn = get_connection()
    rooms = conn.execute("SELECT * FROM rooms ORDER BY type, name").fetchall()
    conn.close()
    return [dict(r) for r in rooms]


def api_get_users():
    """→ GET /api/nutzer"""
    conn = get_connection()
    users = conn.execute(
        "SELECT id, name, email FROM users WHERE active = 1 ORDER BY name"
    ).fetchall()
    conn.close()
    return [dict(u) for u in users]


def api_get_bookings(date=None):
    """→ GET /api/buchungen?datum=YYYY-MM-DD"""
    cleanup_expired_bookings()
    conn = get_connection()
    if date:
        rows = conn.execute("""
            SELECT b.id, b.room_id, b.user_id, b.start_time, b.end_time,
                   b.status, b.checkin_at, b.checkout_at, b.open_end, b.source,
                   u.name as user_name, r.name as room_name,
                   r.type as room_type, r.capacity
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN rooms r ON b.room_id = r.id
            WHERE DATE(b.start_time) = ?
              AND b.status NOT IN ('cancelled','no_show')
            ORDER BY b.start_time
        """, (date,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT b.id, b.room_id, b.user_id, b.start_time, b.end_time,
                   b.status, b.checkin_at, b.checkout_at, b.open_end, b.source,
                   u.name as user_name, r.name as room_name,
                   r.type as room_type, r.capacity
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN rooms r ON b.room_id = r.id
            WHERE b.status NOT IN ('cancelled','no_show')
            ORDER BY b.start_time DESC LIMIT 50
        """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def api_create_booking(room_id, user_id, start_time, end_time=None,
                        open_end=False):
    """→ POST /api/buchen"""
    if end_time and start_time >= end_time:
        return {"success": False, "detail": "Startzeit muss vor Endzeit liegen."}
    bid = add_booking(room_id, user_id, start_time, end_time,
                      source='web', open_end=open_end)
    if not bid:
        return {"success": False,
                "detail": "Kein Platz verfügbar oder Buchungskonflikt."}
    return {"success": True, "booking_id": bid}


def api_cancel_booking(booking_id):
    """→ DELETE /api/buchungen/{id}"""
    conn = get_connection()
    cursor = conn.execute("""
        UPDATE bookings SET status = 'cancelled'
        WHERE id = ? AND status = 'booked'
    """, (booking_id,))
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        return {"success": False, "detail": "Nicht stornierbar."}
    return {"success": True}


def api_simulate_nfc(nfc_uid, room_id):
    """
    → Ausgelöst durch checkin.py (NFC-Reader)
    Vollständige Check-in/out Logik mit Walk-In und Kapazität.
    """
    user = get_user_by_nfc(nfc_uid)
    if not user:
        return {"success": False, "action": None,
                "detail": "Unbekannte Karte – nicht registriert."}

    conn = get_connection()
    room = conn.execute("SELECT * FROM rooms WHERE id = ?",
                        (room_id,)).fetchone()
    conn.close()
    if not room:
        return {"success": False, "action": None, "detail": "Raum nicht gefunden."}

    verfuegbar, frei, gesamt = is_room_available(room_id)

    # Check-OUT wenn bereits eingecheckt
    current = find_current_checkin(user['id'], room_id)
    if current:
        dauer = checkout_booking(current['id'])
        return {
            "success": True,
            "action": "checkout",
            "user": user['name'],
            "booking_id": current['id'],
            "dauer_min": dauer,
            "plaetze_frei": frei + 1,
            "kapazitaet": gesamt
        }

    # Check-IN mit Vorab-Buchung
    booking = find_active_booking(user['id'], room_id)
    if booking:
        checkin_booking(booking['id'])
        return {
            "success": True,
            "action": "checkin",
            "type": "vorab",
            "user": user['name'],
            "booking_id": booking['id'],
            "plaetze_frei": frei - 1,
            "kapazitaet": gesamt
        }

    # Walk-In
    if not room['allow_walkin']:
        return {"success": False, "action": None,
                "detail": f"{room['name']} erlaubt keinen Walk-In."}
    if not verfuegbar:
        return {"success": False, "action": None,
                "detail": f"Raum voll – alle {gesamt} Plätze belegt."}

    bid = create_walkin_booking(user['id'], room_id)
    if not bid:
        return {"success": False, "action": None,
                "detail": "Walk-In Buchung fehlgeschlagen."}
    checkin_booking(bid)
    return {
        "success": True,
        "action": "checkin",
        "type": "walkin",
        "user": user['name'],
        "booking_id": bid,
        "plaetze_frei": frei - 1,
        "kapazitaet": gesamt
    }


# ── Anzeige ────────────────────────────────────────────────

def zeige_raeume():
    rooms = api_get_rooms()
    trennlinie("RÄUME & KAPAZITÄT")
    for r in rooms:
        verfuegbar, frei, gesamt = is_room_available(r['id'])
        ampel = gruen(f"{frei}/{gesamt} frei") if frei > 0 else rot(f"VOLL {gesamt}/{gesamt}")
        walkin = gruen("Walk-In ✓") if r['allow_walkin'] else amber("Nur Vorab")
        print(f"  [{r['id']}] {fett(r['name']):<25} "
              f"{r['type']:<8} | {ampel:<20} | {walkin}")
    trennlinie()


def zeige_buchungen(date=None):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    buchungen = api_get_bookings(date)
    trennlinie(f"BUCHUNGEN – {date}")
    if not buchungen:
        print(amber("  Keine Buchungen für diesen Tag."))
    for b in buchungen:
        status_farbe = {
            "booked":     amber,
            "checked_in": gruen,
            "completed":  muted,
        }.get(b["status"], str)
        ende = "offen" if b["open_end"] and not b["end_time"] else \
               (b["end_time"][11:16] if b["end_time"] else "–")
        checkout = f" out:{b['checkout_at'][11:16]}" if b.get("checkout_at") else ""
        quelle = muted(f"[{b['source']}]")
        print(f"  [{b['id']}] {b['start_time'][11:16]}–{ende:<5}  "
              f"{b['room_name']:<24} {b['user_name']:<20} "
              f"{status_farbe(b['status'])}{checkout} {quelle}")
    trennlinie()


def zeige_nutzer():
    users = api_get_users()
    trennlinie("NUTZER")
    for u in users:
        print(f"  [{u['id']}] {fett(u['name']):<25} {muted(u['email'])}")
    trennlinie()


# ── Aktionen ───────────────────────────────────────────────

def aktion_buchen():
    print(f"\n{fett('── Neue Buchung ──────────────────────────────────')}")
    zeige_raeume()
    zeige_nutzer()

    room_id = eingabe("Raum-ID")
    user_id = eingabe("Nutzer-ID")
    heute   = datetime.now().strftime("%Y-%m-%d")
    datum   = eingabe(f"Datum (leer = heute {heute})", pflicht=False) or heute
    von     = eingabe("Von (HH:MM)")

    print(f"\n  {amber('Endzeit:')} (leer = offenes Ende für Desksharing)")
    bis = eingabe("Bis (HH:MM)", pflicht=False)

    open_end = not bool(bis)
    end_time = f"{datum} {bis}" if bis else None

    result = api_create_booking(
        int(room_id), int(user_id),
        f"{datum} {von}", end_time, open_end=open_end
    )

    if result["success"]:
        print(gruen(f"  ✓ Buchung #{result['booking_id']} erstellt "
                    f"{'(offen)' if open_end else ''}!"))
        print(muted("    → Später: POST /api/buchen → HTTP 200"))
    else:
        print(rot(f"  ✗ {result['detail']}"))


def aktion_nfc_simulieren():
    print(f"\n{fett('── NFC Karte simulieren ──────────────────────────')}")
    print(f"  {amber('1x auflegen = Check-in | 2x auflegen = Check-out')}\n")
    zeige_raeume()

    uid     = eingabe("NFC-Karten-UID")
    room_id = eingabe("Raum-ID")

    print(f"\n  📡 {amber('Lese Karte...')}")
    time.sleep(0.6)

    result = api_simulate_nfc(uid, int(room_id))

    if result["success"]:
        action  = result["action"]
        typ     = result.get("type", "")
        plaetze = f"{result['plaetze_frei']}/{result['kapazitaet']} Plätze frei"

        if action == "checkout":
            dauer = f" | Dauer: {result['dauer_min']} Min" if result.get('dauer_min') else ""
            print(gruen(f"  🔴 CHECK-OUT – {result['user']}{dauer}"))
            print(gruen(f"     Buchung #{result['booking_id']} abgeschlossen"))
        else:
            typ_text = amber(" [Walk-In]") if typ == "walkin" else muted(" [Vorab]")
            print(gruen(f"  🟢 CHECK-IN – {result['user']}{typ_text}"))
            print(gruen(f"     Buchung #{result['booking_id']}"))

        print(muted(f"     → {plaetze}"))
        print(muted(f"     → Später: LED am NFC-Reader leuchtet grün"))
    else:
        print(rot(f"  🔴 ABGELEHNT – {result['detail']}"))
        print(muted(f"     → Später: LED am NFC-Reader leuchtet rot"))


def aktion_stornieren():
    print(f"\n{fett('── Buchung stornieren ────────────────────────────')}")
    zeige_buchungen()
    bid = eingabe("Buchungs-ID")
    result = api_cancel_booking(int(bid))
    if result["success"]:
        print(gruen(f"  ✓ Buchung #{bid} storniert."))
    else:
        print(rot(f"  ✗ {result['detail']}"))


def demo_durchlauf():
    """Automatischer Demo-Durchlauf mit Kapazitäts- und Walk-In-Demo."""
    print(f"\n{fett('── Automatischer Demo-Durchlauf ──────────────────')}")
    print(f"  {amber('Zeigt: Kapazität, Walk-In und Check-out')}\n")

    # Schritt 1
    print(f"  {cyan('Schritt 1:')} Räume mit Kapazitätsanzeige")
    time.sleep(0.5)
    zeige_raeume()
    time.sleep(1)

    # Schritt 2 – Walk-In Nutzer 1
    conn = get_connection()
    u1 = conn.execute("SELECT nfc_uid, name FROM users WHERE id = 2").fetchone()
    u2 = conn.execute("SELECT nfc_uid, name FROM users WHERE id = 3").fetchone()
    u3 = conn.execute("SELECT nfc_uid, name FROM users WHERE id = 4").fetchone()
    conn.close()

    print(f"\n  {cyan('Schritt 2:')} Walk-In Check-in – {u1['name']} (Desksharing Groß)")
    time.sleep(0.5)
    r = api_simulate_nfc(u1['nfc_uid'], 2)
    print(gruen(f"  🟢 {r['action'].upper()} [{r.get('type','')}] – "
                f"{r['plaetze_frei']}/{r['kapazitaet']} Plätze frei")
          if r['success'] else rot(f"  ✗ {r['detail']}"))
    time.sleep(1)

    print(f"\n  {cyan('Schritt 3:')} Walk-In Check-in – {u2['name']}")
    time.sleep(0.5)
    r = api_simulate_nfc(u2['nfc_uid'], 2)
    print(gruen(f"  🟢 {r['action'].upper()} [{r.get('type','')}] – "
                f"{r['plaetze_frei']}/{r['kapazitaet']} Plätze frei")
          if r['success'] else rot(f"  ✗ {r['detail']}"))
    time.sleep(1)

    print(f"\n  {cyan('Schritt 4:')} Räume nach 2 Check-ins")
    zeige_raeume()
    time.sleep(1)

    print(f"\n  {cyan('Schritt 5:')} Check-OUT – {u1['name']} (Karte nochmal)")
    time.sleep(0.5)
    r = api_simulate_nfc(u1['nfc_uid'], 2)
    if r['success'] and r['action'] == 'checkout':
        print(gruen(f"  🔴 CHECK-OUT – Dauer: {r.get('dauer_min', '?')} Min | "
                    f"{r['plaetze_frei']}/{r['kapazitaet']} Plätze frei"))
    time.sleep(1)

    print(f"\n  {cyan('Schritt 6:')} Buchungsübersicht heute")
    zeige_buchungen()

    print(gruen(f"\n  ✓ Demo abgeschlossen!"))
    print(muted(f"    Für Echtbetrieb: py api.py → http://localhost:8000"))


# ── Hauptmenü ──────────────────────────────────────────────

def menu():
    while True:
        print(f"\n{cyan('╔══════════════════════════════════════════════════════╗')}")
        print(f"{cyan('║')}  {fett('Raumbuchungssystem – Lokale Demo')}                   {cyan('║')}")
        print(f"{cyan('║')}  {muted('Walk-In · Kapazität · Check-out')}                   {cyan('║')}")
        print(f"{cyan('╚══════════════════════════════════════════════════════╝')}")

        print(f"\n  {fett('── Ansicht ──────────────────────────────────────')}")
        print("   1  Räume & Kapazität anzeigen")
        print("   2  Nutzer anzeigen")
        print("   3  Buchungen heute")

        print(f"\n  {fett('── Aktionen ─────────────────────────────────────')}")
        print("   4  Neue Buchung (Vorab, mit/ohne Endzeit)")
        print("   5  Buchung stornieren")
        print(f"   {gruen('6')}  {gruen('NFC Karte simulieren (Check-in / Check-out)')}")

        print(f"\n  {fett('── Demo ─────────────────────────────────────────')}")
        print(f"   {gruen('7')}  {gruen('Automatischen Demo-Durchlauf starten')}")

        print(f"\n   {rot('0  Beenden')}")
        trennlinie()

        aktionen = {
            "1": zeige_raeume,
            "2": zeige_nutzer,
            "3": lambda: zeige_buchungen(),
            "4": aktion_buchen,
            "5": aktion_stornieren,
            "6": aktion_nfc_simulieren,
            "7": demo_durchlauf,
        }

        wahl = input("  Auswahl: ").strip()
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
            print(rot("  ✗ Ungültige Eingabe."))
        weiter()


if __name__ == "__main__":
    print(f"\n{amber('Starte lokale Simulation...')}")
    cleanup_expired_bookings()
    menu()
