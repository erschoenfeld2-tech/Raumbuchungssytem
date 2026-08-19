# ══════════════════════════════════════════════════════════════
# ERGÄNZUNG FÜR api.py
# Füge diese Zeilen an den entsprechenden Stellen ein:
# ══════════════════════════════════════════════════════════════

# ── 1. Oben bei den Imports (nach den bestehenden Imports) ──
from notify import sende_buchungsbestaetigung, sende_stornierung

# ── 2. In create_booking() – nach "return {success...}" ─────
# Ersetze den return-Block durch:

def create_booking_neu(req):
    booking_id = add_booking(req.room_id, req.user_id, req.start_time, req.end_time)
    if not booking_id:
        raise Exception("Konflikt")

    # Nutzer- und Raumdaten für E-Mail holen
    conn = get_connection()
    nutzer = conn.execute("SELECT name, email FROM users WHERE id = ?", (req.user_id,)).fetchone()
    raum   = conn.execute("SELECT name FROM rooms WHERE id = ?",        (req.room_id,)).fetchone()
    conn.close()

    # Buchungsbestätigung verschicken
    if nutzer and raum:
        sende_buchungsbestaetigung(
            empfaenger  = nutzer["email"],
            nutzer_name = nutzer["name"],
            raum_name   = raum["name"],
            start_time  = req.start_time,
            end_time    = req.end_time,
            booking_id  = booking_id
        )

    return {"success": True, "booking_id": booking_id}


# ── 3. In cancel_booking() – nach conn.close() ──────────────
# Ergänze vor dem return:

def cancel_booking_ergaenzung(booking_id, conn):
    buchung = conn.execute("""
        SELECT b.start_time, b.end_time, u.name, u.email, r.name as raum
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.id = ?
    """, (booking_id,)).fetchone()

    if buchung:
        sende_stornierung(
            empfaenger  = buchung["email"],
            nutzer_name = buchung["name"],
            raum_name   = buchung["raum"],
            start_time  = buchung["start_time"],
            end_time    = buchung["end_time"]
        )
