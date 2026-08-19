"""
RAUMBUCHUNGSSYSTEM – Alles in einem (mit Login)
================================================
Ein einziges Script:
  - Login-Screen (Username + Passwort '123')
  - 7 Räume: Besprechungsraum, Konferenzraum, ShareDesk 1-5
  - NFC-Reader fest zugeordnet
  - Web-Kalender zum Buchen als eingeloggter Nutzer
  - NFC-Karte auflegen bucht automatisch

Nutzung:
    py raumbuchung.py

Browser öffnet automatisch: http://127.0.0.1:8000
"""

import sqlite3, threading, time, webbrowser, sys, json, secrets
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from http.cookies import SimpleCookie

DB = "raumbuchung.db"
STANDARD_PASSWORT = "123"
NFC_BUCHUNG_DAUER = 60  # Minuten

# ══════════════════════════════════════════════════════════
# KONFIGURATION
# ══════════════════════════════════════════════════════════

READER_RAUM = {
    "ACS ACR122 0": "Besprechungsraum",
    "ACS ACR122 1": "Konferenzraum",
}

RAEUME = [
    "Besprechungsraum",
    "Konferenzraum",
    "ShareDesk 1",
    "ShareDesk 2",
    "ShareDesk 3",
    "ShareDesk 4",
    "ShareDesk 5",
]

NUTZER = [
    ("Berta Langenhahn",     "A8F977E7"),
    ("Familienvater Mayer",  "B81DEBEF"),
    ("Dion Müller",          "B8AED9EF"),
    ("Luca Guinness",        "B851FBE7"),
    ("Eric Nicefield",       "B8F3F9EF"),
]


# ══════════════════════════════════════════════════════════
# DATENBANK
# ══════════════════════════════════════════════════════════

def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = db()
    conn.execute("""CREATE TABLE IF NOT EXISTS nutzer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        nfc_uid TEXT UNIQUE
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS buchungen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raum TEXT NOT NULL,
        nutzer_id INTEGER NOT NULL REFERENCES nutzer(id),
        start TEXT NOT NULL,
        ende TEXT NOT NULL,
        quelle TEXT DEFAULT 'web',
        erstellt TEXT DEFAULT (datetime('now'))
    )""")
    for name, uid in NUTZER:
        try:
            conn.execute("INSERT INTO nutzer (name, nfc_uid) VALUES (?, ?)", (name, uid))
        except sqlite3.IntegrityError:
            pass
    conn.commit()
    conn.close()

def get_nutzer_by_name(name):
    conn = db()
    r = conn.execute("SELECT * FROM nutzer WHERE name = ?", (name,)).fetchone()
    conn.close()
    return dict(r) if r else None

def get_nutzer_by_uid(uid):
    conn = db()
    r = conn.execute("SELECT * FROM nutzer WHERE nfc_uid = ?", (uid,)).fetchone()
    conn.close()
    return dict(r) if r else None

def get_nutzer_by_id(nid):
    conn = db()
    r = conn.execute("SELECT * FROM nutzer WHERE id = ?", (nid,)).fetchone()
    conn.close()
    return dict(r) if r else None

def get_buchungen(datum=None):
    conn = db()
    if datum:
        rows = conn.execute("""
            SELECT b.*, n.name FROM buchungen b
            JOIN nutzer n ON b.nutzer_id = n.id
            WHERE DATE(b.start) = ?
            ORDER BY b.start
        """, (datum,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT b.*, n.name FROM buchungen b
            JOIN nutzer n ON b.nutzer_id = n.id
            ORDER BY b.start DESC LIMIT 100
        """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def check_konflikt(raum, start, ende):
    conn = db()
    conflict = conn.execute("""
        SELECT b.id, n.name FROM buchungen b
        JOIN nutzer n ON b.nutzer_id = n.id
        WHERE b.raum = ? AND b.start < ? AND b.ende > ?
    """, (raum, ende, start)).fetchone()
    conn.close()
    return dict(conflict) if conflict else None

def add_buchung(raum, nutzer_id, start, ende, quelle='web'):
    conflict = check_konflikt(raum, start, ende)
    if conflict:
        return False, f"Raum bereits gebucht von {conflict['name']}"
    conn = db()
    cursor = conn.execute("""
        INSERT INTO buchungen (raum, nutzer_id, start, ende, quelle)
        VALUES (?, ?, ?, ?, ?)
    """, (raum, nutzer_id, start, ende, quelle))
    conn.commit()
    bid = cursor.lastrowid
    conn.close()
    return True, f"Buchung #{bid} erstellt"

def delete_buchung(bid, nutzer_id):
    """Nur der Besitzer der Buchung darf löschen."""
    conn = db()
    r = conn.execute("SELECT nutzer_id FROM buchungen WHERE id = ?", (bid,)).fetchone()
    if not r:
        conn.close()
        return False, "Buchung nicht gefunden"
    if r['nutzer_id'] != nutzer_id:
        conn.close()
        return False, "Du kannst nur eigene Buchungen löschen"
    conn.execute("DELETE FROM buchungen WHERE id = ?", (bid,))
    conn.commit()
    conn.close()
    return True, "Buchung gelöscht"


# ══════════════════════════════════════════════════════════
# SESSION-MANAGEMENT (einfache Cookie-basierte Auth)
# ══════════════════════════════════════════════════════════

SESSIONS = {}  # token → nutzer_id

def login(name, passwort):
    if passwort != STANDARD_PASSWORT:
        return None, "Falsches Passwort"
    n = get_nutzer_by_name(name)
    if not n:
        return None, f"Nutzer '{name}' existiert nicht"
    token = secrets.token_urlsafe(24)
    SESSIONS[token] = n['id']
    return token, None

def logout(token):
    SESSIONS.pop(token, None)

def get_current_user(handler):
    """Liest Session-Cookie und gibt Nutzer zurück, sonst None."""
    cookie_hdr = handler.headers.get('Cookie', '')
    if not cookie_hdr:
        return None
    cookie = SimpleCookie()
    cookie.load(cookie_hdr)
    if 'session' not in cookie:
        return None
    token = cookie['session'].value
    nid = SESSIONS.get(token)
    if not nid:
        return None
    return get_nutzer_by_id(nid)


# ══════════════════════════════════════════════════════════
# NFC-READER (Hintergrund-Thread)
# ══════════════════════════════════════════════════════════

def nfc_worker():
    try:
        from smartcard.System import readers
        from smartcard.util import toHexString
        from smartcard.Exceptions import NoCardException, CardConnectionException
    except ImportError:
        print("[NFC] ✗ pyscard nicht installiert – pip install pyscard")
        return

    while True:
        r = readers()
        if not r:
            print("[NFC] ⚠ Keine Reader gefunden. Warte 5s...")
            time.sleep(5)
            continue

        print(f"[NFC] ✓ {len(r)} Reader gefunden:")
        for reader in r:
            name = str(reader)
            raum = READER_RAUM.get(name, "?")
            print(f"       {name}  →  {raum}")

        last_uids = {str(reader): None for reader in r}

        while True:
            for reader in r:
                reader_name = str(reader)
                raum = READER_RAUM.get(reader_name)
                if not raum:
                    continue
                try:
                    conn = reader.createConnection()
                    conn.connect()
                    response, sw1, sw2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
                    if sw1 == 0x90 and sw2 == 0x00:
                        uid = toHexString(response).replace(" ", "")
                        if uid != last_uids[reader_name]:
                            handle_nfc(uid, raum, conn)
                            last_uids[reader_name] = uid
                except NoCardException:
                    if last_uids[reader_name] is not None:
                        last_uids[reader_name] = None
                except CardConnectionException:
                    pass
                except Exception as e:
                    print(f"[NFC] Fehler bei {reader_name}: {e}")
            time.sleep(0.4)


def handle_nfc(uid, raum, connection):
    print(f"\n[NFC] 📡 Karte: {uid}  → {raum}")
    nutzer = get_nutzer_by_uid(uid)
    if not nutzer:
        print(f"      ✗ Unbekannte Karte")
        led_red(connection)
        return

    print(f"      Nutzer: {nutzer['name']}")
    jetzt = datetime.now()
    start = jetzt.strftime("%Y-%m-%d %H:%M")
    ende  = (jetzt + timedelta(minutes=NFC_BUCHUNG_DAUER)).strftime("%Y-%m-%d %H:%M")

    ok, msg = add_buchung(raum, nutzer['id'], start, ende, quelle='nfc')
    if ok:
        print(f"      ✓ {msg} · {start[11:]}–{ende[11:]}")
        led_green(connection)
    else:
        print(f"      ✗ {msg}")
        led_red(connection)


def led_green(conn):
    try: conn.transmit([0xFF, 0x00, 0x40, 0x0E, 0x04, 0x01, 0x01, 0x01, 0x01])
    except: pass

def led_red(conn):
    try: conn.transmit([0xFF, 0x00, 0x40, 0x05, 0x04, 0x02, 0x02, 0x02, 0x02])
    except: pass


# ══════════════════════════════════════════════════════════
# LOGIN-SEITE
# ══════════════════════════════════════════════════════════

LOGIN_HTML = """<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>Anmelden</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',sans-serif}
  body{background:#0f1117;color:#e8eaf6;min-height:100vh;
    display:flex;align-items:center;justify-content:center;padding:20px}
  .box{background:#1a1d27;border:1px solid #2e3250;border-radius:14px;padding:32px;width:360px;
    box-shadow:0 10px 40px rgba(0,0,0,.4)}
  .logo{width:52px;height:52px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);
    border-radius:12px;display:flex;align-items:center;justify-content:center;
    font-size:26px;margin:0 auto 18px}
  h1{text-align:center;font-size:20px;margin-bottom:6px}
  .sub{text-align:center;color:#8891b4;font-size:13px;margin-bottom:24px}
  label{font-size:12px;color:#8891b4;display:block;margin:12px 0 4px}
  input{width:100%;background:#22263a;border:1px solid #2e3250;color:#e8eaf6;
    padding:10px 12px;border-radius:8px;font-size:14px;outline:none}
  input:focus{border-color:#4f6ef7}
  button{width:100%;background:linear-gradient(135deg,#4f6ef7,#7c3aed);border:none;color:#fff;
    padding:11px;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;margin-top:18px}
  button:hover{opacity:.9}
  .error{background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3);
    border-radius:8px;padding:10px 12px;font-size:13px;margin-top:14px;display:none}
  .error.show{display:block}
  .hint{color:#8891b4;font-size:11px;margin-top:14px;text-align:center;line-height:1.6}
  .hint code{background:#22263a;padding:2px 6px;border-radius:4px;color:#e8eaf6}
</style></head>
<body>
  <div class="box">
    <div class="logo">🏢</div>
    <h1>Raumbuchungssystem</h1>
    <div class="sub">Bitte anmelden</div>
    <label>Nutzername</label>
    <input type="text" id="name" placeholder="z.B. Dion Müller" autofocus/>
    <label>Passwort</label>
    <input type="password" id="pw" placeholder="123"/>
    <button onclick="anmelden()">Anmelden</button>
    <div class="error" id="err"></div>
    <div class="hint">Verfügbare Nutzer:<br>
      Berta Langenhahn · Familienvater Mayer · Dion Müller<br>
      Luca Guinness · Eric Nicefield<br>
      Passwort: <code>123</code></div>
  </div>
<script>
async function anmelden(){
  const name = document.getElementById('name').value.trim();
  const pw = document.getElementById('pw').value;
  const err = document.getElementById('err');
  err.className = 'error';
  if(!name || !pw){ err.textContent = 'Bitte alle Felder ausfüllen.'; err.className = 'error show'; return; }
  const r = await fetch('/api/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({name, passwort: pw})
  });
  const d = await r.json();
  if(d.ok){ location.href = '/'; }
  else { err.textContent = d.msg; err.className = 'error show'; }
}
document.addEventListener('keydown', e => { if(e.key === 'Enter') anmelden(); });
</script>
</body></html>
"""


# ══════════════════════════════════════════════════════════
# HAUPT-SEITE
# ══════════════════════════════════════════════════════════

MAIN_HTML = """<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>Raumbuchung</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',sans-serif}
  body{background:#0f1117;color:#e8eaf6;min-height:100vh;padding:20px}
  h1{font-size:22px;margin-bottom:4px}
  .sub{color:#8891b4;font-size:13px;margin-bottom:20px}

  .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
  .datenav{display:flex;gap:8px;align-items:center}
  button{background:#22263a;border:1px solid #2e3250;color:#e8eaf6;padding:8px 14px;
    border-radius:8px;cursor:pointer;font-size:13px}
  button:hover{background:#2e3250}
  .btn-heute{background:#4f6ef7;border-color:#4f6ef7}
  .btn-logout{background:#22263a;border-color:#2e3250}
  #datum{font-size:15px;font-weight:600;min-width:220px;text-align:center}

  .user-info{display:flex;align-items:center;gap:10px;background:#1a1d27;border:1px solid #2e3250;
    padding:8px 14px;border-radius:8px;font-size:13px}
  .user-info .avatar{width:26px;height:26px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);
    border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px}

  .container{display:grid;grid-template-columns:340px 1fr;gap:20px}

  .card{background:#1a1d27;border:1px solid #2e3250;border-radius:12px;padding:18px;margin-bottom:16px}
  .card h2{font-size:12px;color:#8891b4;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
  label{font-size:12px;color:#8891b4;display:block;margin:8px 0 3px}
  select,input[type=date],input[type=time]{width:100%;background:#22263a;border:1px solid #2e3250;
    color:#e8eaf6;padding:8px 10px;border-radius:8px;font-size:13px;outline:none}
  .zeit-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .btn-book{width:100%;background:linear-gradient(135deg,#4f6ef7,#7c3aed);border:none;color:#fff;
    padding:10px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;margin-top:12px}

  /* Kalender */
  .cal-wrap{overflow-x:auto}
  .cal{background:#1a1d27;border:1px solid #2e3250;border-radius:12px;overflow:hidden;min-width:900px}
  .cal-header{display:grid;background:#22263a;font-size:11px;font-weight:600}
  .cal-header div{padding:12px 8px;text-align:center;border-left:1px solid #2e3250}
  .cal-header div:first-child{border-left:none}
  .cal-body{position:relative}
  .cal-row{display:grid;height:48px}
  .cal-time{padding:0 8px;font-size:11px;color:#8891b4;line-height:48px;text-align:right;
    border-right:1px solid #2e3250}
  .cal-cell{border-left:1px solid #2e3250;border-top:1px solid #22263a;position:relative}
  .cal-cell.half{border-top:1px dashed rgba(46,50,80,.5)}

  .block{position:absolute;left:2px;right:2px;border-radius:5px;padding:4px 6px;
    color:#fff;font-size:11px;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,.3);z-index:2;
    animation:slide .25s ease-out;overflow:hidden}
  .block.web{background:linear-gradient(135deg,#3b4fd4,#6d28d9)}
  .block.nfc{background:linear-gradient(135deg,#15803d,#166534)}
  .block.mine{outline:2px solid #f59e0b;outline-offset:-2px}
  .block .b-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}
  .block .b-time{font-size:9px;opacity:.85}
  .block .b-src{font-size:9px;opacity:.85}
  @keyframes slide{from{opacity:0;transform:translateY(-6px)}to{opacity:1}}

  .now{position:absolute;left:0;right:0;height:2px;background:#ef4444;z-index:3;pointer-events:none}
  .now::before{content:'';position:absolute;left:-4px;top:-4px;width:10px;height:10px;
    background:#ef4444;border-radius:50%}

  #toast{position:fixed;bottom:20px;right:20px;padding:12px 18px;border-radius:10px;color:#fff;
    font-size:13px;font-weight:600;opacity:0;transform:translateY(10px);transition:.25s;pointer-events:none;z-index:100}
  #toast.show{opacity:1;transform:translateY(0)}
  #toast.success{background:#22c55e}
  #toast.error{background:#ef4444}

  .modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;
    align-items:center;justify-content:center}
  .modal-bg.open{display:flex}
  .modal{background:#1a1d27;border:1px solid #2e3250;border-radius:12px;padding:22px;width:340px}
  .modal h3{margin-bottom:12px;font-size:16px}
  .modal p{color:#8891b4;font-size:13px;margin-bottom:6px}
  .modal p strong{color:#e8eaf6}
  .modal-actions{display:flex;gap:8px;margin-top:16px}

  .live{position:fixed;top:20px;right:20px;background:#22c55e;color:#fff;padding:6px 12px;
    border-radius:6px;font-size:11px;display:flex;align-items:center;gap:6px}
  .live .dot{width:7px;height:7px;background:#fff;border-radius:50%;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

  /* Ansicht-Umschalter (Liste / Grundriss) */
  .view-tabs{display:flex;gap:6px;background:#22263a;padding:6px;border-radius:10px;
    margin-bottom:16px;max-width:400px}
  .view-tabs button{flex:1;background:transparent;border:none;color:#8891b4;padding:10px 16px;
    border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;transition:.15s}
  .view-tabs button.active{background:#4f6ef7;color:#fff}

  /* Grundriss – dunkles Design (Blau/Schwarz) */
  .plan-tabs{display:flex;gap:4px;margin-bottom:12px;background:#22263a;padding:4px;border-radius:8px}
  .plan-tabs button{flex:1;background:transparent;border:none;color:#8891b4;padding:8px 10px;
    border-radius:6px;font-size:12px;cursor:pointer;font-weight:500;transition:.15s}
  .plan-tabs button.active{background:#4f6ef7;color:#fff}
  .plan-wrap{background:#0f1117;border:1px solid #2e3250;border-radius:10px;padding:16px}
  .plan-svg{width:100%;height:auto;display:block}
  .plan-room{cursor:pointer;transition:.15s}
  .plan-room:hover .plan-fill{filter:brightness(1.25)}
  .plan-fill{fill:#22263a;stroke:#4f6ef7;stroke-width:2}
  .plan-fill.selected{fill:#4f6ef7;stroke:#7c3aed;stroke-width:3}
  .plan-fill.status-free{fill:#22263a;stroke:#4f6ef7}
  .plan-fill.status-partial{fill:#3b3d5c;stroke:#7c3aed}
  .plan-fill.status-busy{fill:#5c2d3c;stroke:#ef4444}
  .plan-fill.utility{fill:#1a1d27;stroke:#2e3250;stroke-dasharray:4 3}
  .plan-label{fill:#e8eaf6;font-size:12px;font-weight:700;pointer-events:none;text-anchor:middle}
  .plan-sub{fill:#8891b4;font-size:9px;pointer-events:none;text-anchor:middle;font-style:italic}
  .plan-flur{fill:#161923;stroke:#2e3250;stroke-width:1;stroke-dasharray:3 3}
  .plan-flur-label{fill:#8891b4;font-size:11px;text-anchor:middle;font-style:italic}
  .plan-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px;font-size:12px;color:#8891b4}
  .plan-legend span{display:flex;align-items:center;gap:6px}
  .plan-legend .sw{width:14px;height:14px;border-radius:3px;border:1px solid #2e3250}
</style></head>
<body>

<div class="live"><div class="dot"></div>Live</div>

<div class="top">
  <div>
    <h1>🏢 Raumbuchungssystem</h1>
    <div class="sub">Angemeldet als eingeloggter Nutzer</div>
  </div>
  <div class="user-info">
    <div class="avatar" id="avatar">?</div>
    <div>
      <div style="font-weight:600" id="user-name">Lade...</div>
      <div style="color:#8891b4;font-size:11px">eingeloggt</div>
    </div>
    <button class="btn-logout" onclick="logout()">Abmelden</button>
  </div>
</div>

<div class="datenav" style="margin-bottom:20px">
  <button onclick="tag(-1)">← Zurück</button>
  <div id="datum"></div>
  <button onclick="tag(1)">Weiter →</button>
  <button class="btn-heute" onclick="heute()">Heute</button>
</div>

<div class="view-tabs">
  <button id="view-cal" class="active" onclick="switchView('cal')">📋 Liste</button>
  <button id="view-office" onclick="switchView('office')">🗺 Grundriss</button>
</div>

<div class="container">
  <div>
    <div class="card">
      <h2>Neue Buchung</h2>
      <label>Raum</label>
      <select id="f-raum"></select>
      <label>Datum</label>
      <input type="date" id="f-datum"/>
      <div class="zeit-row">
        <div><label>Von</label><input type="time" id="f-start" value="09:00" step="1800"/></div>
        <div><label>Bis</label><input type="time" id="f-ende" value="10:00" step="1800"/></div>
      </div>
      <button class="btn-book" onclick="buchen()">✓ Buchen</button>
    </div>

    <div class="card">
      <h2>Info</h2>
      <p style="color:#8891b4;font-size:12px;line-height:1.6">
        <span style="color:#7c3aed;font-weight:600">■</span> Web-Buchung<br>
        <span style="color:#16a34a;font-weight:600">■</span> NFC-Buchung<br>
        <span style="color:#f59e0b;font-weight:600">▭</span> Deine Buchungen<br><br>
        <strong style="color:#e8eaf6">NFC:</strong> Karte auf Reader legen → automatische Buchung für 60 Minuten.
      </p>
    </div>
  </div>

  <div id="main-area">
    <!-- Kalender-Ansicht (Liste) -->
    <div id="cal-view" class="cal-wrap">
      <div class="cal" id="kalender">Lade...</div>
    </div>

    <!-- Grundriss-Ansicht (groß) -->
    <div id="office-view" style="display:none">
      <div class="plan-tabs" style="max-width:400px">
        <button id="etage-1" class="active" onclick="switchEtage(1)">Etage 1 – Büros</button>
        <button id="etage-2" onclick="switchEtage(2)">Etage 2 – Küche & WC</button>
      </div>
      <div class="plan-wrap">
        <svg class="plan-svg" viewBox="0 0 800 550" id="floorplan"></svg>
      </div>
      <div class="plan-legend">
        <span><span class="sw" style="background:#22263a;border-color:#4f6ef7"></span>frei</span>
        <span><span class="sw" style="background:#3b3d5c;border-color:#7c3aed"></span>teilweise belegt</span>
        <span><span class="sw" style="background:#5c2d3c;border-color:#ef4444"></span>voll belegt</span>
        <span><span class="sw" style="background:#4f6ef7"></span>ausgewählt</span>
        <span><span class="sw" style="background:#1a1d27;border-color:#2e3250"></span>nicht buchbar</span>
      </div>
    </div>
  </div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h3>Buchung</h3>
    <p>Raum: <strong id="m-raum"></strong></p>
    <p>Nutzer: <strong id="m-nutzer"></strong></p>
    <p>Zeit: <strong id="m-zeit"></strong></p>
    <p>Quelle: <strong id="m-quelle"></strong></p>
    <div class="modal-actions">
      <button onclick="modalClose()" style="flex:1">Schließen</button>
      <button id="m-delete" onclick="modalDelete()" style="flex:1;background:#ef4444;border-color:#ef4444;display:none">Löschen</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
let aktDatum = new Date();
let currentUser = null, modalBid = null, modalOwnerId = null;
const RAEUME = __RAEUME__;
const H_START = 7, H_ENDE = 20;

function ds(d){return d.toISOString().split('T')[0]}
function deDatum(d){return d.toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}
function setDatum(){
  document.getElementById('datum').textContent = deDatum(aktDatum);
  document.getElementById('f-datum').value = ds(aktDatum);
}
function tag(n){aktDatum.setDate(aktDatum.getDate()+n); setDatum(); render()}
function heute(){aktDatum = new Date(); setDatum(); render()}

async function ladeUser(){
  const r = await fetch('/api/me');
  if(r.status === 401){ location.href = '/login'; return; }
  currentUser = await r.json();
  document.getElementById('user-name').textContent = currentUser.name;
  document.getElementById('avatar').textContent = currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2);
}

async function logout(){
  await fetch('/api/logout', {method:'POST'});
  location.href = '/login';
}

function initRaumDropdown(){
  document.getElementById('f-raum').innerHTML = RAEUME.map(r =>
    `<option value="${r}">${r}</option>`).join('');
  document.getElementById('f-raum').addEventListener('change', () => {
    drawFloor();
  });
  drawFloor();
}

// ── Grundriss ────────────────────────────────────────────────
const FLOORS = {
  1: {
    outer: {x:30, y:30, w:740, h:490},
    flur:  {x:290, y:60, w:220, h:430},
    flurLabel: "Flur",
    rooms: {
      "Besprechungsraum": {
        x:60, y:60, w:210, h:200, bookable:true, sub:"8 Plätze", furn:"conf"
      },
      "Konferenzraum": {
        x:530, y:60, w:210, h:200, bookable:true, sub:"12 Plätze", furn:"conf"
      },
      "ShareDesk 1": {
        x:60, y:280, w:100, h:210, bookable:true, sub:"Desk 1", furn:"desk-single"
      },
      "ShareDesk 2": {
        x:170, y:280, w:100, h:210, bookable:true, sub:"Desk 2", furn:"desk-single"
      },
      "ShareDesk 3": {
        x:530, y:280, w:100, h:210, bookable:true, sub:"Desk 3", furn:"desk-single"
      },
      "ShareDesk 4": {
        x:640, y:280, w:100, h:100, bookable:true, sub:"Desk 4", furn:"desk-single"
      },
      "ShareDesk 5": {
        x:640, y:390, w:100, h:100, bookable:true, sub:"Desk 5", furn:"desk-single"
      }
    }
  },
  2: {
    outer: {x:30, y:30, w:740, h:490},
    flur:  {x:290, y:60, w:220, h:430},
    flurLabel: "Flur",
    rooms: {
      "Küche": {
        x:60, y:60, w:210, h:250, bookable:false, sub:"nicht buchbar", furn:"kitchen"
      },
      "Essbereich": {
        x:530, y:60, w:210, h:250, bookable:false, sub:"nicht buchbar", furn:"dining"
      },
      "WC Damen": {
        x:60, y:330, w:100, h:160, bookable:false, sub:"♀", furn:"wc"
      },
      "WC Herren": {
        x:170, y:330, w:100, h:160, bookable:false, sub:"♂", furn:"wc"
      },
      "Ruhezone": {
        x:530, y:330, w:210, h:160, bookable:false, sub:"nicht buchbar", furn:"lounge"
      }
    }
  }
};

let currentEtage = 1;
let allBookings = [];

function isBookingActive(b){
  const now = new Date();
  const nowStr = ds(now) + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  return b.start <= nowStr && b.ende > nowStr;
}

function roomStatus(name, room){
  if(!room.bookable) return 'utility';
  const isToday = ds(aktDatum) === ds(new Date());
  const bs = allBookings.filter(b => b.raum === name);
  if(!isToday) return bs.length === 0 ? 'free' : (bs.length > 2 ? 'busy' : 'partial');
  const active = bs.filter(isBookingActive);
  if(active.length > 0) return 'busy';
  if(bs.length > 0) return 'partial';
  return 'free';
}

function switchEtage(nr){
  currentEtage = nr;
  document.getElementById('etage-1').classList.toggle('active', nr === 1);
  document.getElementById('etage-2').classList.toggle('active', nr === 2);
  drawFloor();
}

function switchView(which){
  const calView = document.getElementById('cal-view');
  const officeView = document.getElementById('office-view');
  const btnCal = document.getElementById('view-cal');
  const btnOffice = document.getElementById('view-office');
  if(which === 'office'){
    calView.style.display = 'none';
    officeView.style.display = 'block';
    btnOffice.classList.add('active');
    btnCal.classList.remove('active');
    drawFloor();
  } else {
    calView.style.display = 'block';
    officeView.style.display = 'none';
    btnCal.classList.add('active');
    btnOffice.classList.remove('active');
  }
}

function selectRoomFromPlan(name){
  const room = FLOORS[currentEtage].rooms[name];
  if(!room || !room.bookable) return;
  document.getElementById('f-raum').value = name;
  drawFloor();
  toast('Raum ausgewählt: ' + name, 'success');
}

// Möbel-Zeichenfunktionen (einfache Blau-Schwarz-Symbole)
const FURN_TABLE = 'fill:#2e3250;stroke:#4f6ef7;stroke-width:1';
const FURN_CHAIR = 'fill:#161923;stroke:#4f6ef7;stroke-width:0.8';
const FURN_DESK  = 'fill:#2e3250;stroke:#4f6ef7;stroke-width:1';
const FURN_MON   = 'fill:#4f6ef7';
const FURN_BOX   = 'fill:#2e3250;stroke:#7c3aed;stroke-width:0.8';
const FURN_SOFT  = 'fill:#3b3d5c;stroke:#4f6ef7;stroke-width:0.8';

function furnConf(r){
  const tx = r.x + r.w/2 - 45, ty = r.y + r.h/2 - 20;
  let s = `<rect style="${FURN_TABLE}" x="${tx}" y="${ty}" width="90" height="40" rx="4"/>`;
  for(let i = 0; i < 4; i++){
    const cx = tx + 15 + i*20;
    s += `<rect style="${FURN_CHAIR}" x="${cx-7}" y="${ty-11}" width="14" height="8" rx="1"/>`;
    s += `<rect style="${FURN_CHAIR}" x="${cx-7}" y="${ty+43}" width="14" height="8" rx="1"/>`;
  }
  return s;
}

function furnDeskSingle(r){
  const dw = 60, dh = 30;
  const dx = r.x + r.w/2 - dw/2, dy = r.y + r.h/2 - dh/2;
  let s = `<rect style="${FURN_DESK}" x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="3"/>`;
  s += `<rect style="${FURN_MON}" x="${dx + dw/2 - 8}" y="${dy + 4}" width="16" height="9" rx="1"/>`;
  s += `<rect style="${FURN_CHAIR}" x="${dx + dw/2 - 8}" y="${dy + dh + 4}" width="16" height="9" rx="1"/>`;
  return s;
}

function furnKitchen(r){
  let s = '';
  s += `<rect style="${FURN_BOX}" x="${r.x + 15}" y="${r.y + 40}" width="30" height="${r.h - 65}" rx="2"/>`;
  s += `<rect style="${FURN_MON}" x="${r.x + 20}" y="${r.y + 55}" width="20" height="18" rx="1"/>`;
  s += `<rect style="${FURN_BOX}" x="${r.x + 20}" y="${r.y + 80}" width="20" height="22" rx="1"/>`;
  const ix = r.x + r.w/2 - 30, iy = r.y + r.h/2 + 10;
  s += `<rect style="${FURN_BOX}" x="${ix}" y="${iy}" width="60" height="26" rx="3"/>`;
  return s;
}

function furnDining(r){
  let s = '';
  for(let t = 0; t < 2; t++){
    const tx = r.x + r.w/2 - 40, ty = r.y + 40 + t*95;
    s += `<rect style="${FURN_TABLE}" x="${tx}" y="${ty}" width="80" height="35" rx="3"/>`;
    for(let i = 0; i < 3; i++){
      const cx = tx + 15 + i*25;
      s += `<rect style="${FURN_CHAIR}" x="${cx-7}" y="${ty-10}" width="14" height="8" rx="1"/>`;
      s += `<rect style="${FURN_CHAIR}" x="${cx-7}" y="${ty+37}" width="14" height="8" rx="1"/>`;
    }
  }
  return s;
}

function furnWC(r){
  let s = '';
  s += `<rect style="${FURN_BOX}" x="${r.x + 12}" y="${r.y + 30}" width="${r.w - 24}" height="14" rx="1"/>`;
  s += `<ellipse style="${FURN_SOFT}" cx="${r.x + r.w/2}" cy="${r.y + r.h - 35}" rx="14" ry="18"/>`;
  s += `<rect style="${FURN_SOFT}" x="${r.x + r.w/2 - 10}" y="${r.y + r.h - 60}" width="20" height="8" rx="1"/>`;
  return s;
}

function furnLounge(r){
  let s = '';
  s += `<rect style="${FURN_SOFT}" x="${r.x + 20}" y="${r.y + 30}" width="${r.w - 40}" height="24" rx="4"/>`;
  s += `<rect style="${FURN_SOFT}" x="${r.x + 20}" y="${r.y + r.h - 55}" width="50" height="35" rx="4"/>`;
  s += `<rect style="${FURN_SOFT}" x="${r.x + r.w - 70}" y="${r.y + r.h - 55}" width="50" height="35" rx="4"/>`;
  s += `<rect style="${FURN_TABLE}" x="${r.x + r.w/2 - 25}" y="${r.y + r.h - 45}" width="50" height="22" rx="3"/>`;
  return s;
}

function drawFloor(){
  const svg = document.getElementById('floorplan');
  if(!svg) return;
  const floor = FLOORS[currentEtage];
  const selected = document.getElementById('f-raum').value;
  const outer = floor.outer;
  let s = '';

  // Außenrahmen
  s += `<rect fill="#fff" stroke="#333" stroke-width="4" x="${outer.x}" y="${outer.y}" width="${outer.w}" height="${outer.h}"/>`;

  // Flur
  s += `<rect class="plan-flur" x="${floor.flur.x}" y="${floor.flur.y}" width="${floor.flur.w}" height="${floor.flur.h}"/>`;
  s += `<text class="plan-flur-label" x="${floor.flur.x + floor.flur.w/2}" y="${floor.flur.y + floor.flur.h/2}">${floor.flurLabel}</text>`;

  // Fenster (nur Etage 1 links/rechts an Räumen)
  if(currentEtage === 1){
    s += `<rect class="plan-window" x="${outer.x-1}" y="${outer.y+80}" width="3" height="30"/>`;
    s += `<rect class="plan-window" x="${outer.x-1}" y="${outer.y+230}" width="3" height="30"/>`;
    s += `<rect class="plan-window" x="${outer.x+outer.w-2}" y="${outer.y+80}" width="3" height="30"/>`;
    s += `<rect class="plan-window" x="${outer.x+outer.w-2}" y="${outer.y+230}" width="3" height="30"/>`;
  }

  // Räume
  Object.entries(floor.rooms).forEach(([name, r]) => {
    const status = roomStatus(name, r);
    const isSelected = name === selected && r.bookable;
    const cls = isSelected ? 'selected' : `status-${status}`;
    const clickHandler = r.bookable ? ` onclick="selectRoomFromPlan('${name}')"` : '';

    s += `<g class="plan-room"${clickHandler}>`;
    s += `<rect class="plan-fill ${cls}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;

    // Möbel
    if(r.furn === 'conf') s += furnConf(r);
    else if(r.furn === 'desk-single') s += furnDeskSingle(r);
    else if(r.furn === 'kitchen') s += furnKitchen(r);
    else if(r.furn === 'dining') s += furnDining(r);
    else if(r.furn === 'wc') s += furnWC(r);
    else if(r.furn === 'lounge') s += furnLounge(r);

    // Beschriftung
    s += `<text class="plan-label" x="${r.x + r.w/2}" y="${r.y + 12}">${name}</text>`;
    s += `<text class="plan-sub" x="${r.x + r.w/2}" y="${r.y + r.h - 4}">${r.sub}</text>`;
    s += `</g>`;
  });

  svg.innerHTML = s;
}

async function ladeBuchungen(datum){
  const r = await fetch('/api/buchungen?datum=' + datum);
  return await r.json();
}

async function render(){
  const datum = ds(aktDatum);
  const buchungen = await ladeBuchungen(datum);
  allBookings = buchungen;  // für Grundriss-Farben
  drawFloor();               // Grundriss mit aktuellen Belegungen aktualisieren
  const heute = datum === ds(new Date());
  const cols = `60px repeat(${RAEUME.length}, 1fr)`;

  let html = `<div class="cal-header" style="display:grid;grid-template-columns:${cols}">
    <div></div>
    ${RAEUME.map(r => `<div>${r}</div>`).join('')}
  </div><div class="cal-body">`;

  for(let h = H_START; h < H_ENDE; h++){
    for(let half = 0; half < 2; half++){
      html += `<div class="cal-row" style="display:grid;grid-template-columns:${cols}">
        <div class="cal-time">${half===0 ? String(h).padStart(2,'0')+':00' : ''}</div>
        ${RAEUME.map(() => `<div class="cal-cell${half?' half':''}"></div>`).join('')}
      </div>`;
    }
  }

  html += `<div style="position:absolute;inset:0;pointer-events:none"><div style="position:relative;width:100%;height:100%;pointer-events:auto">`;
  buchungen.forEach(b => {
    const ri = RAEUME.indexOf(b.raum);
    if(ri === -1) return;
    const st = new Date(b.start.replace(' ','T'));
    const et = new Date(b.ende.replace(' ','T'));
    const sMin = st.getHours()*60 + st.getMinutes();
    const eMin = et.getHours()*60 + et.getMinutes();
    const top = (sMin - H_START*60) / 30 * 48;
    const height = Math.max((eMin - sMin) / 30 * 48 - 2, 22);
    const src = b.quelle === 'nfc' ? 'nfc' : 'web';
    const srcLabel = b.quelle === 'nfc' ? '📡 NFC' : '🖥 Web';
    const mine = currentUser && b.nutzer_id === currentUser.id ? ' mine' : '';
    html += `<div class="block ${src}${mine}"
      style="top:${top}px;height:${height}px;
        left:calc(60px + ${ri} * ((100% - 60px) / ${RAEUME.length}) + 2px);
        width:calc((100% - 60px) / ${RAEUME.length} - 4px)"
      onclick="modalOpen(${b.id},${b.nutzer_id},'${b.raum}','${b.name}','${b.start}','${b.ende}','${b.quelle}')">
      <div class="b-name">${b.name}</div>
      <div class="b-time">${b.start.slice(11,16)}–${b.ende.slice(11,16)}</div>
      <div class="b-src">${srcLabel}</div>
    </div>`;
  });
  html += `</div></div>`;

  if(heute){
    const now = new Date();
    const top = (now.getHours()*60 + now.getMinutes() - H_START*60) / 30 * 48;
    if(top >= 0 && top <= (H_ENDE-H_START)*96){
      html += `<div class="now" style="top:${top}px"></div>`;
    }
  }
  html += `</div>`;
  document.getElementById('kalender').innerHTML = html;
}

async function buchen(){
  const raum = document.getElementById('f-raum').value;
  const datum = document.getElementById('f-datum').value;
  const start = document.getElementById('f-start').value;
  const ende = document.getElementById('f-ende').value;

  if(!datum || !start || !ende){ toast('Bitte alle Felder ausfüllen.', 'error'); return; }
  if(start >= ende){ toast('Startzeit muss vor Endzeit liegen.', 'error'); return; }

  const r = await fetch('/api/buchen', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      raum,
      start: datum + ' ' + start,
      ende:  datum + ' ' + ende
    })
  });
  const d = await r.json();
  if(d.ok){ toast('✓ ' + d.msg, 'success'); render(); }
  else { toast('✗ ' + d.msg, 'error'); }
}

function modalOpen(id, ownerId, raum, nutzer, start, ende, quelle){
  modalBid = id;
  modalOwnerId = ownerId;
  document.getElementById('m-raum').textContent = raum;
  document.getElementById('m-nutzer').textContent = nutzer;
  document.getElementById('m-zeit').textContent = start.slice(11,16) + ' – ' + ende.slice(11,16) + ' Uhr';
  document.getElementById('m-quelle').textContent = quelle === 'nfc' ? '📡 NFC-Buchung' : '🖥 Web-Buchung';
  document.getElementById('m-delete').style.display =
    (currentUser && ownerId === currentUser.id) ? 'block' : 'none';
  document.getElementById('modal').classList.add('open');
}
function modalClose(){document.getElementById('modal').classList.remove('open'); modalBid = null;}

async function modalDelete(){
  if(!modalBid) return;
  const r = await fetch('/api/loeschen', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({id: modalBid})
  });
  const d = await r.json();
  modalClose();
  if(d.ok){ toast('Buchung gelöscht', 'success'); render(); }
  else{ toast(d.msg, 'error'); }
}

function toast(msg, typ){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + typ;
  setTimeout(() => t.className = '', 3500);
}

// Init
setDatum();
initRaumDropdown();
ladeUser().then(() => render());
setInterval(render, 3000);
</script>
</body></html>
"""


# ══════════════════════════════════════════════════════════
# HTTP-SERVER
# ══════════════════════════════════════════════════════════

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a, **k): pass

    def _send(self, code, ct, body, extra_headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ct)
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode("utf-8") if isinstance(body, str) else body)

    def _json(self, obj, code=200, extra_headers=None):
        self._send(code, "application/json", json.dumps(obj), extra_headers)

    def _body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        u = urlparse(self.path)
        user = get_current_user(self)

        if u.path == "/login":
            self._send(200, "text/html; charset=utf-8", LOGIN_HTML)
        elif u.path == "/":
            if not user:
                self.send_response(302)
                self.send_header("Location", "/login")
                self.end_headers()
                return
            html = MAIN_HTML.replace("__RAEUME__", json.dumps(RAEUME))
            self._send(200, "text/html; charset=utf-8", html)
        elif u.path == "/api/me":
            if not user:
                self._json({"error": "nicht eingeloggt"}, 401)
                return
            self._json({"id": user['id'], "name": user['name']})
        elif u.path == "/api/buchungen":
            if not user:
                self._json({"error": "nicht eingeloggt"}, 401)
                return
            q = parse_qs(u.query)
            datum = q.get('datum', [None])[0]
            self._json(get_buchungen(datum))
        else:
            self._send(404, "text/plain", "404")

    def do_POST(self):
        if self.path == "/api/login":
            data = self._body()
            token, err = login(data.get('name','').strip(), data.get('passwort',''))
            if err:
                self._json({"ok": False, "msg": err})
                return
            self._json(
                {"ok": True},
                extra_headers={"Set-Cookie": f"session={token}; Path=/; HttpOnly; SameSite=Strict"}
            )
            return

        if self.path == "/api/logout":
            cookie_hdr = self.headers.get('Cookie', '')
            if cookie_hdr:
                cookie = SimpleCookie()
                cookie.load(cookie_hdr)
                if 'session' in cookie:
                    logout(cookie['session'].value)
            self._json({"ok": True})
            return

        user = get_current_user(self)
        if not user:
            self._json({"ok": False, "msg": "Nicht eingeloggt"}, 401)
            return

        if self.path == "/api/buchen":
            data = self._body()
            ok, msg = add_buchung(data['raum'], user['id'], data['start'], data['ende'])
            self._json({"ok": ok, "msg": msg})
        elif self.path == "/api/loeschen":
            data = self._body()
            ok, msg = delete_buchung(data['id'], user['id'])
            self._json({"ok": ok, "msg": msg})
        else:
            self._send(404, "text/plain", "404")


# ══════════════════════════════════════════════════════════
# START
# ══════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 55)
    print("  RAUMBUCHUNGSSYSTEM (mit Login)")
    print("=" * 55)

    init_db()
    print(f"[DB]  ✓ Datenbank bereit ({len(NUTZER)} Nutzer, {len(RAEUME)} Räume)")
    print(f"[LOGIN] Passwort für alle Nutzer: {STANDARD_PASSWORT}")

    threading.Thread(target=nfc_worker, daemon=True).start()

    print("[WEB] Server: http://127.0.0.1:8000")
    print("      Browser öffnet automatisch...")
    print("\nStrg+C zum Beenden\n")

    threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:8000")).start()

    try:
        HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n\nBeendet.")
        sys.exit(0)
