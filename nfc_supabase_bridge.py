"""
Raumbuchungssystem – NFC-Brücke zum LIVE-System (Supabase)
=============================================================
Überwacht ALLE angeschlossenen NFC-Reader gleichzeitig und schreibt
Check-ins DIREKT in die produktive Supabase-Tabelle 'buchungen' –
genau die Tabelle, die index.html im Browser anzeigt. Karten, die hier
gescannt werden, tauchen sofort (nächster Reload / Live-Query) im
Grundriss und in der Tagesansicht auf, markiert mit dem 📡 NFC-Badge.

Unterschied zu checkin.py: checkin.py schreibt in die alte lokale
SQLite-DB (database.py) – das ist die Legacy-Brücke, nicht verbunden
mit der Live-Website. Dieses Skript hier ersetzt sie für den Live-Test.

Ablauf pro Karte:
  1. UID lesen → Nutzer über die RPC-Funktion nutzer_by_nfc() auflösen
     (siehe supabase/migrations/20260831140000_add_nfc_lookup_rpc.sql;
     die Karten-UID selbst ist über den anon key sonst nicht lesbar)
  2. Unbekannte Karte → ablehnen (rote LED)
  3. Läuft für diesen Nutzer in diesem Raum gerade schon eine
     NFC-Buchung? → Check-OUT (Buchung wird auf jetzt verkürzt)
  4. Sonst → Kapazität prüfen (wie index.html: pruefeKapazitaet) und
     Check-IN (neue Buchung, quelle='nfc', Dauer siehe
     nfc_bridge_config.BUCHUNGSDAUER_MINUTEN)

Voraussetzungen:
    pip install pyscard requests
    Python 3.13 (nicht 3.14 – pyscard hat dort noch keine Wheels)
    physischer ACR122U-Reader

Nutzung:
    py list_readers.py           # Reader-Namen ermitteln
    # Namen in nfc_bridge_config.py eintragen
    py nfc_supabase_bridge.py
"""

import time
from datetime import datetime, timedelta

import requests
from smartcard.System import readers
from smartcard.util import toHexString
from smartcard.Exceptions import NoCardException, CardConnectionException

from nfc_bridge_config import READER_ZU_RAUM, STANDARD_RAUM, BUCHUNGSDAUER_MINUTEN

# ── Supabase-Zugang ────────────────────────────────────────
# Dieselben (bewusst öffentlichen) Werte wie in index.html – siehe
# CLAUDE.md: Zugriff wird über RLS-Policies geregelt, nicht über
# Geheimhaltung des anon keys.
SUPABASE_URL = 'https://yugjccgblqsfjasienwa.supabase.co'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1Z2pjY2dibHFzZmphc2llbndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDQ3NDMsImV4cCI6MjEwMDcyMDc0M30.LW2n0hkDPqbP2HGQF6jPL2_Ma66EeO6kG5A2huvFuPM'

HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
    'Content-Type': 'application/json',
}

# Kapazität je Raum – muss zur ROOMS-Konstante in index.html passen.
RAUM_KAPAZITAET = {
    'Besprechungsraum': 1, 'Konferenzraum': 1,
    **{f'ShareDesk {i}': 2 for i in range(1, 11)},
}

FMT = '%Y-%m-%d %H:%M'


# ── NFC-Kommandos (wie checkin.py) ─────────────────────────

def read_uid(connection):
    GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
    response, sw1, sw2 = connection.transmit(GET_UID)
    if sw1 == 0x90 and sw2 == 0x00:
        return toHexString(response).replace(' ', '')
    raise CardConnectionException(f'Lesefehler: SW1={sw1:02X} SW2={sw2:02X}')


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


# ── Supabase-Zugriffe ───────────────────────────────────────

def nutzer_by_nfc(uid):
    """Löst eine Karten-UID über die RPC-Funktion in einen Nutzer auf."""
    r = requests.post(
        f'{SUPABASE_URL}/rest/v1/rpc/nutzer_by_nfc',
        headers=HEADERS, json={'p_nfc_uid': uid}, timeout=5,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def aktive_nfc_buchung(nutzer_id, raum, jetzt):
    """Sucht eine laufende NFC-Buchung dieses Nutzers in diesem Raum."""
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/buchungen',
        headers=HEADERS,
        params={
            'nutzer_id': f'eq.{nutzer_id}',
            'raum': f'eq.{raum}',
            'quelle': 'eq.nfc',
            'start': f'lte.{jetzt}',
            'ende': f'gt.{jetzt}',
            'select': 'id,start,ende',
        },
        timeout=5,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def freie_plaetze(raum, start, ende):
    """Wie pruefeKapazitaet() in index.html: überlappende Buchungen zählen."""
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/buchungen',
        headers=HEADERS,
        params={
            'raum': f'eq.{raum}',
            'start': f'lt.{ende}',
            'ende': f'gt.{start}',
            'select': 'id',
        },
        timeout=5,
    )
    r.raise_for_status()
    belegt = len(r.json())
    kapazitaet = RAUM_KAPAZITAET.get(raum, 1)
    return max(kapazitaet - belegt, 0), kapazitaet


def checkin(nutzer, raum, start, ende):
    r = requests.post(
        f'{SUPABASE_URL}/rest/v1/buchungen',
        headers={**HEADERS, 'Prefer': 'return=representation'},
        json={
            'raum': raum, 'nutzer_id': nutzer['id'], 'name': nutzer['name'],
            'start': start, 'ende': ende, 'quelle': 'nfc',
        },
        timeout=5,
    )
    r.raise_for_status()
    return r.json()[0]


def checkout(buchung_id, jetzt):
    r = requests.patch(
        f'{SUPABASE_URL}/rest/v1/buchungen',
        headers=HEADERS,
        params={'id': f'eq.{buchung_id}'},
        json={'ende': jetzt},
        timeout=5,
    )
    r.raise_for_status()


# ── Hilfsfunktionen ────────────────────────────────────────

def raum_fuer_reader(reader_name):
    if reader_name in READER_ZU_RAUM:
        return READER_ZU_RAUM[reader_name]
    for name, raum in READER_ZU_RAUM.items():
        if name in reader_name or reader_name in name:
            return raum
    return STANDARD_RAUM


# ── Kernlogik ──────────────────────────────────────────────

def process_card(uid, raum, connection, reader_name):
    now = datetime.now()
    jetzt = now.strftime(FMT)

    try:
        nutzer = nutzer_by_nfc(uid)
    except requests.RequestException as e:
        print(f'  [{raum}] ✗ Supabase nicht erreichbar: {e}')
        led_red(connection)
        return

    if not nutzer:
        print(f'  [{raum}] ✗ Unbekannte Karte ({uid}) – nicht registriert.')
        led_red(connection)
        return

    print(f'\n  [{raum}] 📡 Karte: {uid} → 👤 {nutzer["name"]}')

    try:
        laufend = aktive_nfc_buchung(nutzer['id'], raum, jetzt)
    except requests.RequestException as e:
        print(f'  [{raum}] ✗ Supabase nicht erreichbar: {e}')
        led_red(connection)
        return

    # Schon eingecheckt → CHECK-OUT (Buchung auf jetzt verkürzen)
    if laufend:
        try:
            checkout(laufend['id'], jetzt)
        except requests.RequestException as e:
            print(f'  [{raum}] ✗ Check-out fehlgeschlagen: {e}')
            led_red(connection)
            return
        print(f'  [{raum}] 🔴 CHECK-OUT – {nutzer["name"]} (Buchung #{laufend["id"]})')
        led_green(connection)
        return

    # Sonst → CHECK-IN (neue NFC-Buchung, Kapazität prüfen)
    ende = (now + timedelta(minutes=BUCHUNGSDAUER_MINUTEN)).strftime(FMT)
    try:
        frei, gesamt = freie_plaetze(raum, jetzt, ende)
    except requests.RequestException as e:
        print(f'  [{raum}] ✗ Supabase nicht erreichbar: {e}')
        led_red(connection)
        return

    if frei <= 0:
        print(f'  [{raum}] ✗ Raum voll ({gesamt}/{gesamt} belegt).')
        led_red(connection)
        return

    try:
        buchung = checkin(nutzer, raum, jetzt, ende)
    except requests.RequestException as e:
        print(f'  [{raum}] ✗ Check-in fehlgeschlagen: {e}')
        led_red(connection)
        return

    print(f'  [{raum}] 🟢 CHECK-IN (Buchung #{buchung["id"]}) bis {ende[11:]}')
    print(f'  [{raum}]    Plätze: {max(frei-1,0)}/{gesamt} frei')
    led_green(connection)


# ── Multi-Reader Überwachung ───────────────────────────────

def main():
    alle_reader = readers()
    if not alle_reader:
        raise RuntimeError('Keine NFC-Reader gefunden. USB-Verbindung prüfen.')

    print(f"\n{'='*55}")
    print('  Raumbuchungssystem – NFC-Brücke zum Live-System')
    print(f"{'='*55}")

    aktive_reader = []
    for reader in alle_reader:
        reader_name = str(reader)
        raum = raum_fuer_reader(reader_name)
        if raum is None:
            print(f'  ⚠  {reader_name} → keinem Raum zugeordnet (ignoriert)')
            continue
        aktive_reader.append((reader, reader_name, raum))
        print(f'  ✓ {reader_name}\n      → {raum}')

    if not aktive_reader:
        raise RuntimeError(
            'Kein Reader konnte einem Raum zugeordnet werden. '
            'Prüfe nfc_bridge_config.py.'
        )

    print(f"{'='*55}")
    print(f'  {len(aktive_reader)} Reader aktiv. Karte auflegen zum Ein-/Auschecken.')
    print('  Schreibt live in Supabase – sichtbar in index.html im Browser.')
    print('  Strg+C zum Beenden.')
    print(f"{'='*55}")

    last_uids = {name: None for _, name, _ in aktive_reader}

    while True:
        for reader, reader_name, raum in aktive_reader:
            try:
                connection = reader.createConnection()
                connection.connect()
                uid = read_uid(connection)

                if uid != last_uids[reader_name]:
                    process_card(uid, raum, connection, reader_name)
                    last_uids[reader_name] = uid

            except NoCardException:
                if last_uids[reader_name] is not None:
                    last_uids[reader_name] = None
            except CardConnectionException:
                pass
            except Exception:
                pass

        time.sleep(0.4)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n\nSystem beendet.')
    except RuntimeError as e:
        print(f'\nFehler: {e}')
