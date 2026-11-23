"""
Tests für die Kapazitätslogik der NFC-Brücke:  python3 tests/bridge_tests.py
Läuft ohne NFC-Hardware, ohne pyscard und ohne Netzwerk (Module werden
durch Platzhalter ersetzt). Prüft, dass freie_plaetze() dieselben
Ergebnisse liefert wie kapazitaetPruefen() in js/belegung.js.
"""
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Platzhalter für pyscard (smartcard) und requests
for name in ['smartcard', 'smartcard.System', 'smartcard.util', 'smartcard.Exceptions']:
    sys.modules[name] = types.ModuleType(name)
sys.modules['smartcard.System'].readers = lambda: []
sys.modules['smartcard.util'].toHexString = lambda b: ''
class _KartenFehler(Exception):
    pass
sys.modules['smartcard.Exceptions'].NoCardException = _KartenFehler
sys.modules['smartcard.Exceptions'].CardConnectionException = _KartenFehler

antwort = []
class _Antwort:
    def raise_for_status(self):
        pass
    def json(self):
        return antwort
anfragen = []
req = types.ModuleType('requests')
req.RequestException = Exception
req.get = lambda url, **kw: anfragen.append(kw['params']) or _Antwort()
sys.modules.setdefault('requests', req)
sys.modules['requests'] = req

import nfc_supabase_bridge as bruecke  # noqa: E402

def b(start, ende):
    return {'start': '2030-01-01 ' + start, 'ende': '2030-01-01 ' + ende}

fehler = 0
def test(name, bedingung):
    global fehler
    print(('  ✓ ' if bedingung else '  ✗ ') + name)
    fehler += 0 if bedingung else 1

test('nacheinander liegende Buchungen = 1 gleichzeitig',
     bruecke.max_gleichzeitig([b('09:00', '10:00'), b('11:00', '12:00')], '2030-01-01 09:00', '2030-01-01 12:00') == 1)
test('überlappende Buchungen = 2 gleichzeitig',
     bruecke.max_gleichzeitig([b('09:00', '10:00'), b('09:30', '11:00'), b('10:00', '11:00')], '2030-01-01 09:00', '2030-01-01 11:00') == 2)
test('keine Buchungen = 0', bruecke.max_gleichzeitig([], 'a', 'b') == 0)

antwort[:] = [b('09:00', '10:00')]
test('Meetingraum belegt → 0 frei', bruecke.freie_plaetze('Besprechungsraum', '2030-01-01 09:30', '2030-01-01 10:30') == (0, 1))
test('Abfrage ignoriert Test-Buchungen (Gast-Modus)', anfragen[-1].get('test') == 'eq.false')
antwort[:] = [b('09:00', '10:00'), b('11:00', '12:00')]
test('ShareDesk mit nacheinander liegenden Buchungen hat noch 1 Platz',
     bruecke.freie_plaetze('ShareDesk 1', '2030-01-01 09:00', '2030-01-01 12:00') == (1, 2))
test('jeder Reader-Raum hat eine Kapazität', all(r in bruecke.RAUM_KAPAZITAET for r in bruecke.READER_ZU_RAUM.values()))

print('\nBrücken-Tests: ' + ('alle bestanden' if not fehler else f'{fehler} fehlgeschlagen'))
sys.exit(1 if fehler else 0)
