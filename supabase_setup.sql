-- ══════════════════════════════════════════════════════════
-- Raumbuchungssystem – Supabase Tabellen + RLS-Policies
-- Einmalig im Supabase-Projekt unter "SQL Editor" ausführen.
-- ══════════════════════════════════════════════════════════

create table if not exists nutzer (
  id bigint generated always as identity primary key,
  name text not null unique,
  nfc_uid text unique
);

create table if not exists buchungen (
  id bigint generated always as identity primary key,
  raum text not null,
  nutzer_id bigint not null references nutzer(id),
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
