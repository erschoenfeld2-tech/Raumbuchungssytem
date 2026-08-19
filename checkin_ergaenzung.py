# ══════════════════════════════════════════════════════════════
# ERGÄNZUNG FÜR checkin.py
# Füge diese Zeilen an den entsprechenden Stellen ein:
# ══════════════════════════════════════════════════════════════

# ── 1. Oben bei den Imports ──────────────────────────────────
from notify import sende_checkin_bestaetigung

# ── 2. In process_checkin() – nach checkin_booking() ────────
# Direkt nach dieser Zeile:
#   checkin_booking(booking['id'])
# Diese Zeilen ergänzen:

def checkin_ergaenzung(user, booking):
    sende_checkin_bestaetigung(
        empfaenger  = user["email"],
        nutzer_name = user["name"],
        raum_name   = "Raum",           # optional: Raumname aus DB laden
        start_time  = booking["start_time"],
        end_time    = booking["end_time"]
    )
