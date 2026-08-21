-- ══════════════════════════════════════════════════════════
-- Raumbuchungssystem – Supabase Tabellen + RLS-Policies
-- Migration #1 (Ausgangsschema). Wird automatisch per CI/CD-Pipeline
-- (.github/workflows/supabase-deploy.yml) angewendet, sobald diese
-- Datei nach main gepusht wird. Alle Anweisungen sind idempotent
-- (if not exists / on conflict), daher gefahrlos mehrfach ausführbar.
--
-- WICHTIG für künftige Schema-Änderungen: Diese Datei NICHT mehr
-- bearbeiten, sondern eine NEUE Datei in supabase/migrations/ anlegen,
-- z.B. 20260822120000_neue_spalte.sql – siehe CICD_ANLEITUNG.md.
-- ══════════════════════════════════════════════════════════

create table if not exists nutzer (
  id bigint generated always as identity primary key,
  name text not null unique,
  nfc_uid text unique,
  ist_admin boolean not null default false
);

-- Falls die Tabelle schon vorher ohne diese Spalte angelegt wurde:
alter table nutzer add column if not exists ist_admin boolean not null default false;

create table if not exists buchungen (
  id bigint generated always as identity primary key,
  raum text not null,
  nutzer_id bigint not null references nutzer(id),
  name text not null,    -- Name des buchenden Nutzers (Redundanz zu nutzer_id)
  start text not null,   -- Format 'YYYY-MM-DD HH:MM'
  ende text not null,    -- Format 'YYYY-MM-DD HH:MM'
  quelle text not null default 'web' check (quelle in ('web','nfc')),
  erstellt timestamptz not null default now()
);

-- Testnutzer aus der Sprintwoche
insert into nutzer (name, nfc_uid) values
  ('Berta Langenhahn',    'A8F977E7'),
  ('Familienvater Mayer', 'B81DEBEF'),
  ('Dion Müller',         'B8AED9EF'),
  ('Luca Guinness',       'B851FBE7'),
  ('Eric Nicefield',      'B8F3F9EF')
on conflict (name) do nothing;

-- Administrator: darf jede Buchung jedes Nutzers löschen (Passwort ist im
-- Frontend hinterlegt, nicht in der DB – siehe ADMIN_PASSWORT in index.html)
insert into nutzer (name, ist_admin) values ('Admin_Universal', true)
on conflict (name) do update set ist_admin = true;

-- Row-Level-Security aktivieren
alter table nutzer enable row level security;
alter table buchungen enable row level security;

-- Web-App (anon key) und lokales NFC-Skript brauchen vollen Zugriff.
-- Für ein Schulprojekt ohne echte Auth reicht "alle dürfen alles" –
-- kein Enterprise-Rechtesystem nötig.
create policy "nutzer_select" on nutzer for select using (true);

create policy "buchungen_select" on buchungen for select using (true);
create policy "buchungen_insert" on buchungen for insert with check (true);
create policy "buchungen_delete" on buchungen for delete using (true);
create policy "buchungen_update" on buchungen for update using (true);
