"""
Raumbuchungssystem – Reader-zu-Raum Zuordnung
==============================================
Hier wird festgelegt, welcher physische NFC-Reader zu welchem Raum gehört.

Der Reader-Name kommt aus 'py list_readers.py'.
Die room_id kommt aus der Datenbank (py database.py zeigt sie an).

Beim Umstecken der Reader oder Hinzufügen weiterer Räume
muss NUR diese Datei angepasst werden.
"""

# Zuordnung: Reader-Name → Raum-ID
# Reader-Namen exakt so wie in 'py list_readers.py' angezeigt
READER_ZU_RAUM = {
    "ACS ACR122 0": 2,   # → Desksharing Raum Groß (4 Plätze)
    "ACS ACR122 1": 3,   # → Desksharing Raum Klein (2 Plätze)
}

# Fallback wenn ein Reader nicht in der Liste steht:
# None = Reader ignorieren, oder eine Raum-ID als Standard
STANDARD_RAUM = None
