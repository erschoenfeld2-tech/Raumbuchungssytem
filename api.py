"""
Raumbuchungssystem - Web-Backend (api.py) – erweitert
======================================================
Neu:
  - Walk-In Buchung per NFC
  - Kapazitätsprüfung für Mehrpersonen-Räume
  - Check-out Endpunkt
  - Offene Buchungen ohne Endzeit

Installation:
    pip install fastapi uvicorn

Starten:
    py api.py
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from datetime import datetime
import uvicorn
import socket
import os

from database import (
    get_connection, add_booking,
    find_active_booking, find_current_checkin,
    checkin_booking, checkout_booking,
    create_walkin_booking, is_room_available,
    get_live_occupancy, get_occupancy_at,
    cleanup_expired_bookings, init_db, get_user_by_nfc
)

try:
    from notify import sende_buchungsbestaetigung
    EMAIL_AKTIV = True
except ImportError:
    EMAIL_AKTIV = False

app = FastAPI(title="Raumbuchungssystem")


# ── Eingabe-Modelle ────────────────────────────────────────

class BuchungErstellen(BaseModel):
    raum_id: int
    nutzer_id: int
    start_time: str
    end_time: str = None
    open_end: bool = False

class StornierungAnfrage(BaseModel):
    buchung_id: int

class CheckinAnfrage(BaseModel):
    nfc_uid: str
    raum_id: int


# ── HTML ausliefern ────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def index():
    html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index_lokal_modular.html")
    if not os.path.exists(html_path):
        return HTMLResponse("<h1>index_lokal_modular.html nicht gefunden</h1>", status_code=404)
    with open(html_path, encoding="utf-8") as f:
        return HTMLResponse(f.read())


# ── Räume ──────────────────────────────────────────────────

@app.get("/api/raeume")
def get_raeume():
    conn = get_connection()
    raeume = conn.execute("SELECT * FROM rooms ORDER BY type, name").fetchall()
    conn.close()
    result = []
    for r in raeume:
        d = dict(r)
        belegt, gesamt, frei = get_live_occupancy(r['id'])
        d['plaetze_belegt'] = belegt
        d['plaetze_frei']   = frei
        d['plaetze_gesamt'] = gesamt
        d['voll'] = frei == 0
        result.append(d)
    return result


# ── Nutzer ─────────────────────────────────────────────────

@app.get("/api/nutzer")
def get_nutzer():
    conn = get_connection()
    nutzer = conn.execute(
        "SELECT id, name, email FROM users WHERE active = 1 ORDER BY name"
    ).fetchall()
    conn.close()
    return [dict(u) for u in nutzer]


# ── Buchungen ──────────────────────────────────────────────

@app.get("/api/buchungen")
def get_buchungen(datum: str = None):
    cleanup_expired_bookings()
    conn = get_connection()
    if datum:
        rows = conn.execute("""
            SELECT b.id, b.start_time, b.end_time, b.status,
                   b.checkin_at, b.checkout_at, b.open_end, b.source,
                   u.name as nutzer, u.id as nutzer_id, r.name as raum,
                   r.id as raum_id, r.capacity, r.type as raum_typ
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN rooms r ON b.room_id = r.id
            WHERE DATE(b.start_time) = ?
              AND b.status NOT IN ('cancelled','no_show')
            ORDER BY b.start_time
        """, (datum,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT b.id, b.start_time, b.end_time, b.status,
                   b.checkin_at, b.checkout_at, b.open_end, b.source,
                   u.name as nutzer, u.id as nutzer_id, r.name as raum,
                   r.id as raum_id, r.capacity, r.type as raum_typ
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN rooms r ON b.room_id = r.id
            WHERE b.status NOT IN ('cancelled','no_show')
            ORDER BY b.start_time DESC LIMIT 100
        """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/belegung")
def get_belegung(datum: str):
    """
    Berechnet die Belegung pro Raum und 30-Minuten-Slot für einen Tag.
    Wird für die Kapazitäts-Badges im Kalender genutzt.
    Gibt pro Raum eine Liste von Slots mit Belegungszahl zurück.
    """
    conn = get_connection()
    raeume = conn.execute("SELECT id, capacity FROM rooms").fetchall()

    buchungen = conn.execute("""
        SELECT room_id, start_time, end_time, checkout_at, open_end, status
        FROM bookings
        WHERE DATE(start_time) = ?
          AND status NOT IN ('cancelled', 'no_show')
    """, (datum,)).fetchall()
    conn.close()

    # Slots von 07:00 bis 20:00 in 30-Min-Schritten
    result = {}
    for room in raeume:
        rid = room['id']
        kapazitaet = room['capacity']
        slots = {}
        for stunde in range(7, 20):
            for minute in (0, 30):
                slot_key = f"{stunde:02d}:{minute:02d}"
                slot_dt = f"{datum} {slot_key}:00"
                # Zähle Buchungen die diesen Slot überschneiden
                belegt = 0
                for b in buchungen:
                    if b['room_id'] != rid:
                        continue
                    start = b['start_time']
                    if len(start) == 16:
                        start += ":00"
                    ende = b['end_time']
                    if ende and len(ende) == 16:
                        ende += ":00"
                    # Slot liegt im Buchungszeitraum?
                    if start <= slot_dt:
                        if ende and ende > slot_dt:
                            belegt += 1
                        elif not ende and b['open_end'] and not b['checkout_at']:
                            belegt += 1
                if belegt > 0:
                    slots[slot_key] = {"belegt": belegt, "kapazitaet": kapazitaet}
        result[rid] = slots
    return result


# ── Buchen ─────────────────────────────────────────────────

@app.post("/api/buchen")
def buchen(data: BuchungErstellen):
    try:
        datetime.strptime(data.start_time, "%Y-%m-%d %H:%M")
        if data.end_time:
            datetime.strptime(data.end_time, "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(400, "Ungültiges Zeitformat. Erwartet: YYYY-MM-DD HH:MM")

    bid = add_booking(
        data.raum_id, data.nutzer_id,
        data.start_time, data.end_time,
        source='web', open_end=data.open_end
    )
    if not bid:
        raise HTTPException(409, "Kein Platz verfügbar oder Buchungskonflikt.")

    if EMAIL_AKTIV:
        try:
            conn = get_connection()
            u = conn.execute("SELECT * FROM users WHERE id=?", (data.nutzer_id,)).fetchone()
            r = conn.execute("SELECT * FROM rooms WHERE id=?",  (data.raum_id,)).fetchone()
            conn.close()
            sende_buchungsbestaetigung(
                u["email"], u["name"], r["name"],
                data.start_time, data.end_time or "offen", bid)
        except Exception:
            pass

    return {"status": "ok", "buchung_id": bid}


# ── Stornieren ─────────────────────────────────────────────

@app.post("/api/stornieren")
def stornieren(data: StornierungAnfrage):
    conn = get_connection()
    b = conn.execute("""
        SELECT b.*, u.name, u.email, r.name as raum
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.id = ?
    """, (data.buchung_id,)).fetchone()

    if not b:
        conn.close()
        raise HTTPException(404, "Buchung nicht gefunden.")
    if b["status"] not in ("booked", "checked_in"):
        conn.close()
        raise HTTPException(400, f"Status '{b['status']}' – kann nicht storniert werden.")

    conn.execute("UPDATE bookings SET status='cancelled' WHERE id=?",
                 (data.buchung_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


# ── NFC Check-in / Check-out / Walk-In ─────────────────────

@app.post("/api/checkin")
def checkin(data: CheckinAnfrage):
    """
    Vollständige NFC-Logik:
    1. Bereits eingecheckt? → Check-OUT
    2. Vorab-Buchung?       → Check-IN
    3. Walk-In erlaubt?     → Walk-In + Check-IN
    """
    user = get_user_by_nfc(data.nfc_uid)
    if not user:
        raise HTTPException(404, "Unbekannte NFC-Karte.")

    conn = get_connection()
    room = conn.execute("SELECT * FROM rooms WHERE id = ?",
                        (data.raum_id,)).fetchone()
    conn.close()
    if not room:
        raise HTTPException(404, "Raum nicht gefunden.")

    verfuegbar, frei, gesamt = is_room_available(data.raum_id)

    # Check-OUT
    current = find_current_checkin(user['id'], data.raum_id)
    if current:
        dauer = checkout_booking(current['id'])
        return {
            "status": "ok",
            "action": "checkout",
            "nutzer": user['name'],
            "buchung_id": current['id'],
            "dauer_min": dauer,
            "plaetze_frei": frei + 1,
            "kapazitaet": gesamt
        }

    # Check-IN mit Vorab-Buchung
    booking = find_active_booking(user['id'], data.raum_id)
    if booking:
        checkin_booking(booking['id'])
        return {
            "status": "ok",
            "action": "checkin",
            "type": "vorab",
            "nutzer": user['name'],
            "buchung_id": booking['id'],
            "plaetze_frei": max(frei - 1, 0),
            "kapazitaet": gesamt
        }

    # Walk-In
    if not room['allow_walkin']:
        raise HTTPException(403, f"{room['name']} erlaubt keinen Walk-In.")
    if not verfuegbar:
        raise HTTPException(409, f"Raum voll – alle {gesamt} Plätze belegt.")

    bid = create_walkin_booking(user['id'], data.raum_id)
    if not bid:
        raise HTTPException(500, "Walk-In Buchung fehlgeschlagen.")
    checkin_booking(bid)
    return {
        "status": "ok",
        "action": "checkin",
        "type": "walkin",
        "nutzer": user['name'],
        "buchung_id": bid,
        "plaetze_frei": max(frei - 1, 0),
        "kapazitaet": gesamt
    }


# ── Statistik ──────────────────────────────────────────────

@app.get("/api/statistik")
def statistik():
    conn = get_connection()
    d = {
        "buchungen_gesamt": conn.execute(
            "SELECT COUNT(*) FROM bookings").fetchone()[0],
        "checkins": conn.execute(
            "SELECT COUNT(*) FROM bookings WHERE checkin_at IS NOT NULL").fetchone()[0],
        "no_shows": conn.execute(
            "SELECT COUNT(*) FROM bookings WHERE status='no_show'").fetchone()[0],
        "nutzer":   conn.execute(
            "SELECT COUNT(*) FROM users WHERE active=1").fetchone()[0],
        "raeume":   conn.execute(
            "SELECT COUNT(*) FROM rooms").fetchone()[0],
    }
    conn.close()
    return d


# ── Start ──────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    cleanup_expired_bookings()

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"

    print("\n" + "=" * 50)
    print("  Raumbuchungssystem – Web-Server")
    print("=" * 50)
    print(f"  Lokal:    http://localhost:8000")
    print(f"  Netzwerk: http://{local_ip}:8000")
    print("  Stoppen:  Strg+C")
    print("=" * 50 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=8000)
