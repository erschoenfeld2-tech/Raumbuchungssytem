# CI/CD-Pipeline für Supabase – Anleitung

Diese Pipeline sorgt dafür, dass Änderungen am Datenbank-Schema (neue
Tabellen, Spalten, Policies) automatisch auf das Supabase-Projekt
angewendet werden, sobald sie nach `main` gepusht werden. Du musst nie
wieder manuell SQL in den Supabase-SQL-Editor kopieren.

**Wichtig:** Supabase hostet nicht die Website selbst – das übernimmt
weiterhin GitHub Pages. Diese Pipeline kümmert sich ausschließlich um
die Datenbank (Tabellen, Spalten, Rechte).

## Wie es funktioniert

- Schema-Änderungen liegen als SQL-Dateien in `supabase/migrations/`
- Jede Datei beginnt mit einem Zeitstempel (`YYYYMMDDHHMMSS_name.sql`)
  und wird **genau einmal** angewendet
- Bei jedem Push nach `main`, der Dateien in `supabase/migrations/`
  ändert, läuft automatisch der GitHub-Actions-Workflow
  `.github/workflows/supabase-deploy.yml`: zuerst ein Validierungs-Job
  (Namenskonvention, riskante Statements wie `DROP TABLE`/`TRUNCATE`),
  danach erst `supabase db push` gegen dein Projekt
- Parallele Deployments sind über eine `concurrency`-Gruppe blockiert –
  zwei gleichzeitige Pushes können sich nicht gegenseitig überholen
- Kein automatischer `db reset`, kein automatisches Seed-Deployment auf
  Produktion – die Pipeline wendet ausschließlich neue Migrationen an

## Einmalige Einrichtung (das musst du tun)

### 1. Supabase Access Token erstellen

1. Öffne [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
2. **"Generate new token"** klicken, einen Namen vergeben (z.B. `github-actions`)
3. Token kopieren (wird nur einmal angezeigt!)

### 2. Datenbank-Passwort besorgen

Das ist **nicht** der anon key, sondern das Postgres-Passwort:

1. Im Supabase-Projekt: **Project Settings → Database**
2. Falls du es nicht mehr weißt: dort **"Reset database password"**
   klicken und ein neues setzen (merken/notieren!)

### 3. Beide Werte als GitHub-Secrets hinterlegen

1. Im Repo: **Settings → Secrets and variables → Actions**
2. **"New repository secret"** zweimal anlegen:
   - Name: `SUPABASE_ACCESS_TOKEN` → Wert: Token aus Schritt 1
   - Name: `SUPABASE_DB_PASSWORD` → Wert: Passwort aus Schritt 2

Das war's – die Pipeline ist danach einsatzbereit.

### 4. Optional, aber empfohlen: GitHub Environment "production"

Der Deploy-Job ist an ein Environment namens `production` gebunden
(`environment: production` in `supabase-deploy.yml`). Ohne dieses
Environment läuft die Pipeline trotzdem ganz normal – erst wenn du es
anlegst, kannst du zusätzliche Schutzregeln aktivieren (z.B. dass ein
Mitglied den Lauf erst bestätigen muss, bevor Migrationen wirklich auf
der produktiven Datenbank landen):

1. Im Repo: **Settings → Environments → New environment**
2. Name exakt `production` eingeben, erstellen
3. Optional: unter "Deployment protection rules" einen Reviewer
   festlegen
4. Optional: Die beiden Secrets aus Schritt 3 stattdessen hier im
   Environment hinterlegen statt auf Repo-Ebene (dann gelten sie nur
   für Jobs, die dieses Environment nutzen)

## Zukünftige Schema-Änderungen

1. Neue Datei in `supabase/migrations/` anlegen, Name mit aktuellem
   Zeitstempel beginnend, z.B.:
   ```
   supabase/migrations/20260901120000_neue_spalte.sql
   ```
2. Nur die **neue** Änderung reinschreiben (z.B. `alter table ...`),
   alte Migrationsdateien nie mehr bearbeiten
3. Committen und nach `main` pushen → Pipeline läuft automatisch

Der Fortschritt lässt sich im Repo unter dem Tab **"Actions"**
verfolgen.

## Falls der erste Lauf fehlschlägt

Möglich, da dies nicht automatisiert getestet werden konnte (keine
Netzwerkverbindung zu Supabase aus der Entwicklungsumgebung heraus).
Häufigste Ursache: falsches DB-Passwort oder Token ohne Rechte auf das
Projekt. Schau im Actions-Tab in die Fehlermeldung des roten Laufs und
schick sie mir – dann fixen wir das gezielt.
