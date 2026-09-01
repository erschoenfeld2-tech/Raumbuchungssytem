"""
Raumbuchungssystem – NFC-Brücke: Reader-zu-Raum Zuordnung (Live-System)
=========================================================================
Gehört zu nfc_supabase_bridge.py, NICHT zu checkin.py (das ist die alte
Brücke zur lokalen SQLite-DB, siehe reader_config.py).

Hier wird festgelegt, welcher physische NFC-Reader zu welchem Raum des
LIVE-Systems gehört. Die Raumnamen müssen exakt den Namen aus der
ROOMS-Konstante in index.html entsprechen (Groß-/Kleinschreibung inkl.),
da sie 1:1 in die Supabase-Spalte buchungen.raum geschrieben werden:

  Etage 1: Besprechungsraum, Konferenzraum, ShareDesk 1..5
  Etage 2: ShareDesk 6..10

Der Reader-Name kommt aus 'py list_readers.py'.

Beim Umstecken der Reader oder Hinzufügen weiterer Räume muss NUR diese
Datei angepasst werden.
"""

# Zuordnung: Reader-Name (aus list_readers.py) → Raumname (aus index.html)
READER_ZU_RAUM = {
    "ASCACR1220": "Besprechungsraum",
    "ASCACR1221": "Konferenzraum",
}

# Fallback wenn ein angeschlossener Reader nicht in der Liste steht:
# None = Reader ignorieren, oder ein Raumname als Standard
STANDARD_RAUM = None

# Länge einer NFC-Buchung in Minuten (Check-in = jetzt, Ende = jetzt + Dauer).
# Das Live-Schema kennt keine "offenen" Buchungen ohne Endzeit (anders als
# die alte SQLite-Version) – ein zweites Auflegen derselben Karte vor
# Ablauf dieser Zeit verkürzt die Buchung auf die tatsächliche Verweildauer
# (Check-out).
BUCHUNGSDAUER_MINUTEN = 60
