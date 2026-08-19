# Übergabe an Claude Code — Raumbuchungssystem

Hi Claude, du übernimmst ein laufendes Schulprojekt. Lies erst diesen Prompt komplett durch, dann sag mir was du siehst und was du zuerst machen willst.

## Kontext in einem Satz

Wir bauen für die "Hausmesse"-Präsentation an unserer Berufsschule (Walther-Rathenau-Gewerbeschule, Fachinformatik für Systemintegration, Abgabe 24.11.2026) ein Raumbuchungssystem mit NFC-Check-in und grafischer Grundriss-Ansicht.

## Team

- **Dion Himaj** — Programmentwicklung (34 %)
- **David Mayer** — Standgestaltung, Programmverbesserungen (33 %)
- **Eric Schoenfeld** — Dokumentation, Programmverbesserungen (33 %)

## Aktueller Stand nach der Sprintwoche 22.–29.07.2026

Es gibt aktuell **eine Single-Page-Web-App** (`index.html`), die auf **GitHub Pages** live läuft und eine **Supabase (PostgreSQL)** als Backend nutzt. Parallel läuft ein **lokales Python-NFC-Skript** auf einem Laptop mit **2× ACR122U** NFC-Reader, das direkt in dieselbe Supabase-Datenbank schreibt.

Vorher gab es eine ältere Version als reines Python-Programm (Datei `raumbuchung.py` in den outputs, ca. 1000 Zeilen) mit lokaler SQLite-Datenbank und eingebautem HTTP-Server. Diese Version ist überholt, dient aber als Referenz für die Logik.

### Räume (12 buchbare Einheiten, 2 Etagen)

- **Etage 1**: Besprechungsraum, Konferenzraum, ShareDesk 1–5
- **Etage 2**: ShareDesk 6–10
- ShareDesks haben Kapazität 2 (zwei Personen gleichzeitig möglich); Meetingräume Kapazität 1

### Nutzer und Testkarten (in DB gespeichert)

- Berta Langenhahn → UID `A8F977E7`
- Familienvater Mayer → UID `B81DEBEF`
- Dion Müller → UID `B8AED9EF`
- Luca Guinness → UID `B851FBE7`
- Eric Nicefield → UID `B8F3F9EF`
- Standard-Passwort für Web-Login: `123`

### NFC-Reader-Zuordnung

- `ACS ACR122 0` → Besprechungsraum
- `ACS ACR122 1` → Konferenzraum

## Was funktioniert

1. Web-Login mit Nutzername + Passwort
2. Kalenderansicht mit Buchungen als farbige Blöcke (violett = Web, grün = NFC)
3. 2D-Grundriss-Ansicht im dunkelblauen Systemdesign, klickbare Räume
4. Umschalter Liste ↔ Grundriss oben über dem Hauptbereich
5. Etagen-Umschalter (Etage 1 / Etage 2)
6. Konflikterkennung bei Doppelbuchungen (mit Fehlermeldung "Raum bereits gebucht von …")
7. Löschen nur eigener Buchungen
8. Live-Refresh alle paar Sekunden
9. NFC-Skript liest Karten, identifiziert Nutzer, schreibt 60-Min-Buchung in Supabase
10. Mobile-Layout einspaltig, Agenda-Liste oben mit Zeit/Raum/Nutzer/Quelle

## Bekannte offene Punkte

- Etagenwechsel muss Dropdown, Listenansicht und Kalender gemeinsam mitwechseln (Grundriss-Auswahl-Umrandung ging manchmal verloren)
- Raumnamen im Kalender müssen exakt zu Raumnamen in der DB passen (case-sensitive)
- Agenda-Liste auf Mobile könnte klickbar sein (Modal für Buchungs-Details) — optional
- Feinschliff Bugfixes generell
- Screenshots und Grafiken für die Doku (Organigramm, Gantt, Systemarchitektur)

## Technischer Stack (aktuell)

- **Frontend**: Single HTML-Datei (`index.html`) mit Vanilla JS, CSS, SVG
- **Backend**: Supabase (PostgreSQL + REST-API), Tabelle `buchungen`
- **Deployment**: GitHub Pages
- **NFC vor Ort**: Python 3.13 + pyscard (WICHTIG: nicht 3.14, keine Wheels), ACR122U-Reader über PC/SC
- **Farbschema Web**: Dunkelblau/Schwarz-Theme, Akzent `#4F6EF7`, Purple `#7C3AED`, Dark `#1A1D27`

## Datenbank-Tabellen in Supabase

- `nutzer` (id, name, nfc_uid) — falls noch nicht angelegt, hier neu erstellen
- `buchungen` (id, raum, nutzer_id, start, ende, quelle, erstellt) — `quelle` ist `'web'` oder `'nfc'`
- Row-Level-Security-Policies für select/insert/delete/update müssen gesetzt sein, sonst schreibt weder Web noch NFC-Skript

## Referenz-Dateien im ZIP

Im ZIP findest du:

- `raumbuchung.py` — die alte lokale Vollversion (Login, DB, Grundriss, NFC), Logik zum Nachlesen
- `nfc_test.py` — minimales NFC-Testskript
- `checkin.py`, `checkin_debug.py`, `reader_config.py`, `list_readers.py` — NFC-Reader-Helfer
- `database.py`, `api.py`, `index.html`, `admin.py`, `notify.py`, `demo.py`, `config.py` — alte modulare Version
- `test_nfc_read.py` — Standalone-Test zum UID-Auslesen einer Karte
- `Projektdokumentation_Raumbuchungssystem.docx` — aktuelle Doku-Version
- `Sitzungsprotokolle_Raumbuchungssystem.docx` — alle Sitzungsprotokolle
- `Mitarbeiter_Anleitung_Raumbuchung.docx` — Nutzeranleitung

## Was ich als Nächstes brauche

Ich werde dir gleich sagen, was heute dran ist. Möglich sind zum Beispiel:

- Live-System auf Mobile testen und Bugs fixen
- Agenda-Liste klickbar machen
- Neues Feature (z. B. Auto-Checkout, Karten-Rückgabe, Statistik)
- Doku-Grafiken erstellen (Organigramm, Gantt, Systemarchitektur als PNG/SVG)
- Präsentation vorbereiten
- Standdesign umsetzen

## So arbeite bitte mit mir

1. **Frag nach, wenn was unklar ist** — lieber eine Rückfrage als eine falsche Annahme
2. **Kleine Schritte** — nicht 500 Zeilen auf einmal umbauen, sondern gezielt ändern und testen lassen
3. **Erklär mir kurz was du machst** — ich lerne dabei mit, ich bin Fachinformatik-Azubi
4. **Deutsche Kommentare** im Code, deutsche Fehlermeldungen im UI
5. **Farbschema und Stil beibehalten** — dunkelblau/schwarz, kein weißes Design
6. **Nichts überflüssig komplex machen** — es ist ein Schulprojekt, keine Enterprise-Software

Wenn du das gelesen hast, sag kurz: welche Dateien du dir zuerst anschaust, was du zum Start noch wissen willst, und dann warte auf meinen konkreten Auftrag.
