"""
NFC-TEST – Alles-in-Einem
==========================
Ein einziges Script:
  - Startet Web-Server auf http://127.0.0.1:8000
  - Überwacht beide NFC-Reader im Hintergrund
  - Zeigt jede Kartenbuchung sofort als Block im Browser
  - Volle Debug-Ausgabe im Terminal

Nutzung:
    py nfc_test.py

Browser öffnet dann automatisch. Karte auf einen Reader legen.
"""

import sqlite3, threading, time, webbrowser, sys
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

DB = "nfc_test.db"

# ── READER-ZUORDNUNG ──────────────────────────────────────
READER_ROOM = {
    "ACS ACR122 0": "Raum A",
    "ACS ACR122 1": "Raum B",
}

# ── DATENBANK EINRICHTEN ──────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB)
    conn.execute("""CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zeit TEXT NOT NULL,
        reader TEXT NOT NULL,
        raum TEXT NOT NULL,
        uid TEXT NOT NULL,
        aktion TEXT NOT NULL
    )""")
    conn.commit()
    conn.close()

def log_event(reader, raum, uid, aktion):
    conn = sqlite3.connect(DB)
    conn.execute(
        "INSERT INTO logs (zeit, reader, raum, uid, aktion) VALUES (?,?,?,?,?)",
        (datetime.now().strftime("%H:%M:%S"), reader, raum, uid, aktion)
    )
    conn.commit()
    conn.close()

def get_logs():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM logs ORDER BY id DESC LIMIT 50").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def clear_logs():
    conn = sqlite3.connect(DB)
    conn.execute("DELETE FROM logs")
    conn.commit()
    conn.close()


# ── NFC-READER-THREAD ─────────────────────────────────────
def nfc_worker():
    """Läuft im Hintergrund und überwacht beide Reader."""
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
            raum = READER_ROOM.get(name, "?")
            print(f"       - {name}  →  {raum}")

        last_uids = {str(reader): None for reader in r}

        while True:
            for reader in r:
                reader_name = str(reader)
                raum = READER_ROOM.get(reader_name, "Unbekannt")
                try:
                    conn = reader.createConnection()
                    conn.connect()
                    response, sw1, sw2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
                    if sw1 == 0x90 and sw2 == 0x00:
                        uid = toHexString(response).replace(" ", "")
                        if uid != last_uids[reader_name]:
                            print(f"\n[NFC] 📡 KARTE ERKANNT")
                            print(f"      Reader: {reader_name}")
                            print(f"      Raum:   {raum}")
                            print(f"      UID:    {uid}")
                            log_event(reader_name, raum, uid, "gebucht")
                            # Grüne LED
                            try:
                                conn.transmit([0xFF, 0x00, 0x40, 0x0E, 0x04, 0x01, 0x01, 0x01, 0x01])
                            except: pass
                            last_uids[reader_name] = uid
                except NoCardException:
                    if last_uids[reader_name] is not None:
                        last_uids[reader_name] = None
                except CardConnectionException:
                    pass
                except Exception as e:
                    print(f"[NFC] Fehler bei {reader_name}: {e}")
            time.sleep(0.4)


# ── HTML-SEITE ────────────────────────────────────────────
HTML = """<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>NFC-Test</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',sans-serif}
  body{background:#0f1117;color:#e8eaf6;min-height:100vh;padding:24px}
  h1{margin-bottom:6px;font-size:22px}
  .sub{color:#8891b4;font-size:13px;margin-bottom:20px}
  .rooms{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
  .room{background:#1a1d27;border:1px solid #2e3250;border-radius:12px;padding:20px;min-height:280px}
  .room h2{font-size:16px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #2e3250;display:flex;justify-content:space-between}
  .room h2 span{font-size:12px;color:#8891b4;font-weight:400}
  .block{background:linear-gradient(135deg,#3b4fd4,#6d28d9);color:#fff;padding:12px 14px;
    border-radius:8px;margin-bottom:8px;font-size:13px;box-shadow:0 3px 10px rgba(0,0,0,.3);
    animation:slide .3s ease-out}
  @keyframes slide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
  .block .top{display:flex;justify-content:space-between;margin-bottom:4px;font-weight:700}
  .block .uid{font-family:'Courier New',monospace;font-size:11px;opacity:.9}
  .empty{color:#8891b4;font-size:13px;text-align:center;padding:40px 0;font-style:italic}
  .actions{margin-top:20px;display:flex;gap:10px}
  button{background:#22263a;border:1px solid #2e3250;color:#e8eaf6;padding:8px 16px;
    border-radius:8px;cursor:pointer;font-size:13px}
  button:hover{background:#2e3250}
  .status{position:fixed;bottom:20px;right:20px;background:#22c55e;color:#fff;
    padding:8px 14px;border-radius:8px;font-size:12px;display:flex;align-items:center;gap:8px}
  .status .dot{width:8px;height:8px;background:#fff;border-radius:50%;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style></head>
<body>
  <h1>🔍 NFC-Buchungstest</h1>
  <div class="sub">Karte auf einen Reader halten → Block erscheint automatisch</div>

  <div class="rooms">
    <div class="room"><h2>Raum A <span id="ca">0 Buchungen</span></h2><div id="ra"></div></div>
    <div class="room"><h2>Raum B <span id="cb">0 Buchungen</span></h2><div id="rb"></div></div>
  </div>

  <div class="actions">
    <button onclick="clearAll()">🗑 Alles löschen</button>
    <button onclick="load()">🔄 Neu laden</button>
  </div>

  <div class="status"><div class="dot"></div>Live · aktualisiert alle 2s</div>

<script>
async function load(){
  const r = await fetch('/api/logs');
  const logs = await r.json();
  const ra = logs.filter(l=>l.raum==='Raum A');
  const rb = logs.filter(l=>l.raum==='Raum B');
  document.getElementById('ca').textContent = ra.length + ' Buchungen';
  document.getElementById('cb').textContent = rb.length + ' Buchungen';
  document.getElementById('ra').innerHTML = ra.length
    ? ra.map(l=>block(l)).join('')
    : '<div class="empty">Noch keine Buchung.<br>Karte auf Reader A halten.</div>';
  document.getElementById('rb').innerHTML = rb.length
    ? rb.map(l=>block(l)).join('')
    : '<div class="empty">Noch keine Buchung.<br>Karte auf Reader B halten.</div>';
}
function block(l){
  return `<div class="block">
    <div class="top"><span>✓ Buchung</span><span>${l.zeit}</span></div>
    <div class="uid">UID: ${l.uid}</div>
  </div>`;
}
async function clearAll(){
  await fetch('/api/clear', {method:'POST'});
  load();
}
load();
setInterval(load, 2000);
</script>
</body></html>
"""


# ── HTTP-SERVER ───────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a, **k): pass  # keine Logs ins Terminal

    def _send(self, code, ct, body):
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.end_headers()
        self.wfile.write(body.encode("utf-8") if isinstance(body,str) else body)

    def do_GET(self):
        if self.path == "/":
            self._send(200, "text/html; charset=utf-8", HTML)
        elif self.path == "/api/logs":
            self._send(200, "application/json", json.dumps(get_logs()))
        else:
            self._send(404, "text/plain", "404")

    def do_POST(self):
        if self.path == "/api/clear":
            clear_logs()
            self._send(200, "application/json", json.dumps({"ok":True}))
        else:
            self._send(404, "text/plain", "404")


# ── START ─────────────────────────────────────────────────
if __name__ == "__main__":
    print("="*55)
    print("  NFC-BUCHUNGSTEST")
    print("="*55)
    init_db()
    clear_logs()

    # NFC-Thread starten
    t = threading.Thread(target=nfc_worker, daemon=True)
    t.start()

    # Browser öffnen
    print("\n[WEB] Server startet auf http://127.0.0.1:8000")
    print("      Browser öffnet automatisch...")
    print("\n[NFC] Warte auf Karten... (Strg+C zum Beenden)\n")

    threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:8000")).start()

    try:
        HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n\nBeendet.")
        sys.exit(0)
