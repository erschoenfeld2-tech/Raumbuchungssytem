"""
Raumbuchungssystem – NFC-Brücke: Reader-zu-Raum Zuordnung (Live-System)
=========================================================================
Gehört zu nfc_supabase_bridge.py, NICHT zu checkin.py (das ist die alte
Brücke zur lokalen SQLite-DB, siehe reader_config.py).

Hier wird festgelegt, welcher physische NFC-Reader zu welchem Raum des
LIVE-Systems gehört. Die Raumnamen müssen exakt den Raumnamen aus den
Etagen-Dateien etagen/*.js (bzw. einer im Browser angelegten Etage)
entsprechen (Groß-/Kleinschreibung inkl.), da sie 1:1 in die
Supabase-Spalte buchungen.raum geschrieben werden:

  Hauptgebäude Etage 1: Besprechungsraum, Konferenzraum, ShareDesk 1..5
  Hauptgebäude Etage 2: ShareDesk 6..10

Räume mit Reader in der Etagen-Datei zusätzlich mit nfc: true markieren
(dann sind sie im Gast-/Testsystem nur per Karte buchbar).

Der Reader-Name kommt aus 'py list_readers.py'.

Beim Umstecken der Reader oder Hinzufügen weiterer Räume muss NUR diese
Datei angepasst werden.
"""

# Zuordnung: Reader-Name (aus list_readers.py) → Raumname (aus etagen/*.js)
READER_ZU_RAUM = {
    "ACS ACR122 0": "Besprechungsraum",
    "ACS ACR122 1": "Konferenzraum",
}

# Kapazität (= Anzahl Tische) je Raum mit Reader – muss zur Etagen-Datei passen
# (Meetingräume 1, ShareDesks = Anzahl "tische"). Nicht eingetragene Räume: 1.
RAUM_KAPAZITAET = {
    "Besprechungsraum": 1,
    "Konferenzraum": 1,
    **{f"ShareDesk {i}": 2 for i in range(1, 11)},
}

# Fallback wenn ein angeschlossener Reader nicht in der Liste steht:
# None = Reader ignorieren, oder ein Raumname als Standard
STANDARD_RAUM = None

# Länge einer NFC-Buchung in Minuten (Check-in = jetzt, Ende = jetzt + Dauer).
# Das Live-Schema kennt keine "offenen" Buchungen ohne Endzeit (anders als
# die alte SQLite-Version) – ein erneutes Auflegen derselben Karte vor
# Ablauf dieser Zeit gilt nicht als Check-out, sondern verlängert die
# laufende Buchung um weitere BUCHUNGSDAUER_MINUTEN.
BUCHUNGSDAUER_MINUTEN = 60
