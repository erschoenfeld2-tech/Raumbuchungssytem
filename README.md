# Raumbuchungssystem

Raumbuchungssystem mit NFC-Check-in und grafischer Grundriss-Ansicht.
Schulprojekt (Fachinformatik Systemintegration, Walther-Rathenau-Gewerbeschule),
gebaut für die "Hausmesse"-Präsentation (Abgabe 24.11.2026).

## Architekturübersicht

Dieses Repository enthält **drei unabhängige, historisch gewachsene Implementierungen**
derselben Idee. Nur eine davon ist tatsächlich live. Details und Begründung stehen in
[`CLAUDE.md`](CLAUDE.md) — hier die Kurzfassung:

| | Live-System | Alte modulare Version | Älteste Version |
|---|---|---|---|
| Frontend | `index.html` | `index_lokal_modular.html` | in `raumbuchung.py` eingebettet |
| Backend | Supabase (Postgres + REST) | `api.py` (FastAPI) + `database.py` (SQLite) | eingebauter `http.server` + SQLite |
| Status | **deployed, in Benutzung** | lokales Referenzprojekt | lokales Referenzprojekt |
| Deployment | GitHub Pages (`main`) | manuell `py api.py` | manuell `py raumbuchung.py` |

Das **Live-System** ist eine einzelne statische HTML-Datei (Vanilla JS/CSS, inline SVG
für den Grundriss, kein Build-Schritt, kein Framework), die direkt mit Supabase über den
öffentlichen `anon key` spricht. Zugriffsrechte werden über Postgres
Row-Level-Security-Policies geregelt, nicht durch Geheimhaltung des Keys.

Zusätzlich gibt es ein **NFC-Legacy-Toolkit** (`checkin.py`, `nfc_test.py`, `reader_config.py`
u. a.) für ACR122U-Kartenleser. Wichtige Einschränkung: Diese Skripte schreiben in die alte
lokale SQLite-Datenbank (`database.py`), **nicht** in die Live-Supabase-Tabelle `buchungen` —
sie dienen nur noch als Logik-Referenz.

Die tatsächliche **NFC-Anbindung ans Live-System** ist `nfc_supabase_bridge.py` +
`nfc_bridge_config.py`: derselbe Reader-Polling-Ablauf wie `checkin.py`, aber die Karten-UID
wird über die Postgres-Funktion `nutzer_by_nfc()` aufgelöst und Check-ins landen direkt per
PostgREST (mit demselben `anon key` wie `index.html`) in `buchungen` mit `quelle='nfc'` —
sichtbar in der Live-Website beim nächsten Reload.

## Voraussetzungen

- Für das Live-System: nichts weiter als ein Browser — `index.html` ist eine fertige,
  statische Datei.
- Für die Legacy-Python-Prototypen: Python **3.13** (nicht 3.14 — für `pyscard` gibt es
  dort noch keine Wheels), `pip install fastapi uvicorn pydantic pyscard` je nach Skript.
  Es gibt kein `requirements.txt`; Abhängigkeiten stehen nur im Docstring jeder Datei.
- Für NFC-Tests: physischer ACR122U-Kartenleser.
- Für Datenbank-Änderungen: [Supabase CLI](https://supabase.com/docs/guides/cli), falls
  lokal getestet werden soll (optional — die CI/CD-Pipeline übernimmt das produktiv).

## Umgebungsvariablen

**Keine.** Weder das Live-System noch die Legacy-Prototypen lesen Umgebungsvariablen.
Supabase-URL und `anon key` stehen als Konstanten direkt in `index.html` (bewusst, siehe
oben); die Legacy-Prototypen nutzen `config.py` für Einstellungen statt `.env`. Es gibt
deshalb keine `.env.example` in diesem Repository — sie würde eine Infrastruktur vortäuschen,
die hier nicht existiert.

## Lokale Installation & Entwicklungsablauf

Es gibt keinen Build-Schritt für das Live-System:

```bash
# Live-App lokal ansehen
open index.html   # oder im Browser öffnen
```

Änderungen an `index.html` direkt im Editor vornehmen und im Browser neu laden.

Für die Legacy-Prototypen:

```bash
# Alte modulare Version
py database.py     # legt raumbuchung.db an
py api.py           # startet FastAPI-Server auf Port 8000

# Älteste Einzeldatei-Version
py raumbuchung.py   # eigene SQLite-DB, eingebauter Server, Port 8000

# NFC-Legacy-Toolkit (Hardware nötig, schreibt in lokale SQLite-DB)
py list_readers.py  # Reader-Namen ermitteln, in reader_config.py eintragen
py checkin.py

# NFC-Brücke zum Live-System (Hardware nötig, schreibt live in Supabase)
py list_readers.py  # Reader-Namen ermitteln, in nfc_bridge_config.py eintragen
py nfc_supabase_bridge.py
```

## Build

Kein Build-Schritt vorhanden — `index.html` wird unverändert ausgeliefert. Die
GitHub-Actions-Pipeline (`.github/workflows/pages-deploy.yml`) kopiert lediglich
`index.html` und `.nojekyll` in ein Deployment-Artefakt.

## Tests, Linting und Formatierung

Es gibt kein Test-Framework, keinen Linter und keinen Formatter in diesem Projekt — für
eine einzelne statische HTML-Datei ohne Build-Toolchain wäre das unverhältnismäßig
(siehe `CLAUDE.md`, Abschnitt "Conventions"). Stattdessen läuft bei jedem Push/PR ein
leichtgewichtiger **Quality-Check** (`.github/workflows/quality.yml`), der ohne
zusätzliche Abhängigkeiten prüft:

- alle `*.py`-Dateien kompilieren fehlerfrei (`py_compile`)
- das eingebettete `<script>` in `index.html` und `index_lokal_modular.html` ist
  syntaktisch gültiges JavaScript (`node --check`)
- beide HTML-Dateien sind wohlgeformt
- alle Workflow-YAML-Dateien und `supabase/config.toml` sind syntaktisch gültig
- Migrationsdateien folgen der Namenskonvention und enthalten keine offensichtlich
  riskanten Statements (`DROP TABLE`, `TRUNCATE`, `DELETE` ohne `WHERE`)

Manuell vor jedem Commit sinnvoll: die betroffene Seite tatsächlich im Browser
durchklicken (Login, Buchung anlegen, Grundriss, Etagenwechsel) — das automatisiert
diese Pipeline bewusst nicht.

## Lokale Supabase-Einrichtung

1. Supabase-Projekt anlegen (falls noch nicht vorhanden) unter
   [supabase.com](https://supabase.com)
2. Projekt-URL und `anon key` (Project Settings → API) in `index.html` eintragen
   (Konstanten `SUPABASE_URL` / `SUPABASE_ANON_KEY`)
3. Schema anlegen — entweder automatisch per CI/CD (siehe unten) oder einmalig manuell
   im SQL-Editor: Inhalt aller Dateien aus `supabase/migrations/` in Reihenfolge der
   Zeitstempel ausführen

## Datenbankmigrationen erstellen und testen

Neue Schema-Änderungen kommen **immer** als neue, eigene Datei in `supabase/migrations/`:

```
supabase/migrations/YYYYMMDDHHMMSS_kurze_beschreibung.sql
```

- Zeitstempel muss größer sein als der der letzten vorhandenen Migration
- Bestehende Migrationsdateien **nie** nachträglich bearbeiten, auch nicht für
  Korrekturen — dafür eine neue, korrigierende Migration anlegen
- SQL nach Möglichkeit idempotent schreiben (`if not exists`, `on conflict do nothing`)
- Lokal testen: Datei im Supabase SQL-Editor gegen ein Test-Projekt ausführen, oder mit
  installierter Supabase-CLI `supabase db push` gegen ein verlinktes Test-Projekt

## GitHub-Pages-Deployment

Automatisiert über `.github/workflows/pages-deploy.yml`: läuft bei jedem Push nach
`main`, prüft zuerst die Quality-Checks, deployt danach `index.html` +`.nojekyll`.
Manuell auslösbar über den Actions-Tab (`workflow_dispatch`).

**Einmalige manuelle Einrichtung:** Repo-Settings → Pages → Source muss von
"Deploy from a branch" auf **"GitHub Actions"** umgestellt werden. Bis dahin bleibt die
bisherige klassische Auslieferung von `main`/root aktiv (kein Blackout).

## Supabase-CI/CD

Automatisiert über `.github/workflows/supabase-deploy.yml`. Vollständige
Schritt-für-Schritt-Anleitung inkl. Screenshots-Beschreibung in
[`CICD_ANLEITUNG.md`](CICD_ANLEITUNG.md). Kurzfassung:

- läuft bei Push nach `main`, wenn sich `supabase/migrations/**` ändert
- wendet Migrationen per Supabase CLI (`supabase db push`) an, in Zeitstempel-Reihenfolge
- führt vorher denselben Quality-Check aus (u. a. Migrations-Namenskonvention, riskante
  Statements)
- kein automatischer `db reset`, kein automatisches Seed-Deployment auf Produktion
- manuell auslösbar über `workflow_dispatch`

## Benötigte GitHub Secrets

| Secret | Wofür | Woher |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Authentifizierung der Supabase-CLI in der Pipeline | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_DB_PASSWORD` | Datenbank-Passwort für `supabase db push` | Supabase-Projekt → *Project Settings → Database* |

Die Projekt-Referenz (`yugjccgblqsfjasienwa`) steht direkt im Workflow — sie ist nicht
geheim, da sie ohnehin Teil der öffentlichen Supabase-URL in `index.html` ist.

## Erforderliche manuelle Repository-Einstellungen

- **Settings → Secrets and variables → Actions**: die beiden Secrets oben anlegen
- **Settings → Environments**: optional, für dieses Team bewusst nicht eingerichtet.
  Ein Environment `production` würde `supabase-deploy.yml` erlauben, produktive
  Deployments abzusichern (z. B. Reviewer vorschreiben) — ohne dieses Environment läuft
  die Pipeline ganz normal automatisch weiter, wie aktuell eingerichtet
- **Settings → Pages**: Source auf "GitHub Actions" umstellen (siehe oben)
- Repo-Sichtbarkeit muss **öffentlich** sein, damit GitHub Pages ohne kostenpflichtigen
  Plan funktioniert (bereits erledigt)

## Branch- und Pull-Request-Workflow

- Niemals direkt auf `main` committen
- Für jede Änderung einen eigenen Branch von `main` abzweigen, sprechender Name
  (z. B. `fix/...`, `feat/...`, `refactor/...`)
- Commit-Konvention: [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix:`, `feat:`, `refactor:`, `docs:`, `ci:`, `test:`)
- Pull Request gegen `main`, Quality-Check muss grün sein

## Troubleshooting

**"Relationship-Fehler zwischen nutzer und buchungen"**
Die Web-App lädt Nutzernamen absichtlich über eine separate Abfrage (`nutzerMap`) statt
über eine eingebettete Supabase-Relation — das funktioniert unabhängig davon, ob ein
Fremdschlüssel-Constraint im Schema-Cache erkannt wurde. Tritt der Fehler trotzdem auf,
prüfen ob `supabase/migrations/` vollständig angewendet wurde.

**"null value in column ... violates not-null constraint" beim Buchen**
Die tatsächliche Tabellenstruktur in Supabase weicht von der erwarteten ab. Mit
`select column_name, is_nullable from information_schema.columns where table_name='buchungen';`
im SQL-Editor prüfen, welche Spalte fehlt, und eine korrigierende Migration ergänzen.

**GitHub Pages zeigt 404 oder alte Version**
Cache-bedingt — harter Reload (Strg+Shift+R). Prüfen, ob Pages-Source auf `main`/`GitHub Actions`
zeigt (Settings → Pages) und ob der letzte Workflow-Lauf im Actions-Tab grün ist.

**Login schlägt fehl trotz korrektem Passwort**
Der Nutzername wird per `ilike` gegen die `nutzer_public`-View geprüft (Groß-/Kleinschreibung
egal, aber der Name muss exakt existieren). Tippfehler oder fehlender Nutzer in der DB
sind die häufigste Ursache.

**NFC-Karte wird nicht erkannt**
`py list_readers.py` prüft, ob der Reader überhaupt erkannt wird (USB-Verbindung, Treiber).
Betrifft sowohl das Legacy-Toolkit (`checkin.py` etc., lokale SQLite-DB) als auch die
Live-Brücke (`nfc_supabase_bridge.py`) — beide nutzen dieselbe PC/SC-Anbindung über `pyscard`.

**Karte wird erkannt, aber Check-in schlägt fehl / Nutzer "unbekannt"**
Betrifft `nfc_supabase_bridge.py`. Prüfen: (1) Ist die Karten-UID in der `nutzer`-Tabelle
hinterlegt (`nfc_uid`-Spalte)? (2) Ist die Migration
`supabase/migrations/20260831140000_add_nfc_lookup_rpc.sql` deployt (RPC `nutzer_by_nfc`
muss existieren)? (3) Steht der Raumname in `nfc_bridge_config.py` (`READER_ZU_RAUM`) exakt
so wie in der `ROOMS`-Konstante in `index.html`?
