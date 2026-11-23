-- ══════════════════════════════════════════════════════════
-- Gast-Sitzungen, Änderungslimit und Datenschutz
--
-- 1. Datenschutz: Nutzernamen sind über den öffentlichen anon key nicht
--    mehr lesbar (View nutzer_public gesperrt, Spalte buchungen.name nicht
--    mehr auswählbar). Die Website zeigt fremde Buchungen nur als "belegt";
--    den eigenen Namen liefert ausschließlich nutzer_login() beim Anmelden.
-- 2. Jeder Gast bekommt eine eigene Sitzung (gast_sitzung_starten()).
--    Test-Buchungen und Gast-Etagen hängen an dieser Sitzung:
--      • Gast-Etagen sieht nur die eigene Sitzung (gast_etagen_laden),
--      • gast_zuruecksetzen() löscht nur die EIGENEN Änderungen,
--      • alles andere räumt test_buchungen_aufraeumen() automatisch auf
--        (Buchungen nach 2 Min., Gast-Etagen nach 15 Min. ohne Änderung).
--    Die Sitzungs-ID ist geheim (zufällige UUID) und wird nie ausgeliefert;
--    lesbar ist nur ihr SHA-256-Hash (buchungen.gast_hash), damit der Browser
--    eigene Test-Buchungen erkennt.
-- 3. Limit: höchstens 10 Änderungen (Buchen, Löschen, Etage speichern/
--    löschen) pro Gast-Sitzung in 2 Minuten – geprüft in der Datenbank.
-- 4. Admin: testsystem_leeren() löscht alle Test-Buchungen und Gast-Etagen
--    (Admin-Passwort wird serverseitig geprüft).
-- Test-Buchungen entstehen nur noch über gast_buchen(); ein direktes Insert
-- mit test = true wird vom Trigger abgewiesen.
-- ══════════════════════════════════════════════════════════

-- ── Gast-Sitzungen ──
create table if not exists gast_sitzungen (
  id uuid primary key default gen_random_uuid(),
  erstellt timestamptz not null default now()
);
create table if not exists gast_aenderungen (
  sitzung uuid not null references gast_sitzungen(id) on delete cascade,
  zeit timestamptz not null default now()
);
create index if not exists gast_aenderungen_sitzung_zeit_idx on gast_aenderungen (sitzung, zeit);
create table if not exists gast_etagen (
  sitzung uuid not null references gast_sitzungen(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9-]{1,60}$'),
  definition jsonb not null,
  aktualisiert timestamptz not null default now(),
  primary key (sitzung, id)
);
-- Kein direkter Zugriff für anon/authenticated – nur über die Funktionen unten
alter table gast_sitzungen enable row level security;
alter table gast_aenderungen enable row level security;
alter table gast_etagen enable row level security;
revoke all on gast_sitzungen, gast_aenderungen, gast_etagen from anon, authenticated;

alter table buchungen add column if not exists gast_sitzung uuid references gast_sitzungen(id) on delete cascade;
alter table buchungen add column if not exists gast_hash text
  generated always as (case when gast_sitzung is null then null
                            else encode(sha256(gast_sitzung::text::bytea), 'hex') end) stored;

-- ── 1. Datenschutz ──
revoke select on nutzer_public from anon, authenticated;
revoke select on buchungen from anon, authenticated;
grant select (id, raum, tisch, nutzer_id, start, ende, quelle, test, erstellt, gast_hash)
  on buchungen to anon, authenticated;

-- ── Trigger: Test-Buchungen nur über gast_buchen(), Sitzung unveränderlich ──
create or replace function buchungen_pruefen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.erstellt := now();
    if new.test and coalesce(current_setting('rb.gast_rpc', true), '') <> 'on' then
      raise exception 'Test-Buchungen entstehen nur über das Testsystem (gast_buchen).';
    end if;
  else
    new.erstellt := old.erstellt;
    if new.test is distinct from old.test or new.gast_sitzung is distinct from old.gast_sitzung then
      raise exception 'test und gast_sitzung einer Buchung sind nicht änderbar.';
    end if;
  end if;
  if not new.test and new.gast_sitzung is not null then
    raise exception 'Echte Buchungen gehören zu keiner Gast-Sitzung.';
  end if;

  if new.start >= new.ende then
    raise exception 'Startzeit muss vor Endzeit liegen.';
  end if;

  if new.tisch is not null then
    perform pg_advisory_xact_lock(hashtext('buchung:' || new.raum));
    if exists (
      select 1 from buchungen b
      where b.raum = new.raum
        and b.tisch = new.tisch
        and b.test = new.test
        and b.id is distinct from new.id
        and b.start < new.ende
        and b.ende > new.start
    ) then
      raise exception 'Tisch % ist in diesem Zeitraum bereits belegt.', new.tisch
        using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$$;

-- ── Hilfsfunktion: Sitzung prüfen und Änderung zählen (intern) ──
-- Liefert die Zahl der danach noch erlaubten Änderungen.
create or replace function gast_aenderung_zaehlen(p_sitzung uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anzahl int;
begin
  if p_sitzung is null or not exists (select 1 from gast_sitzungen where id = p_sitzung) then
    raise exception 'Gast-Sitzung abgelaufen – bitte erneut „Als Gast testen“ wählen.';
  end if;
  delete from gast_aenderungen where zeit < now() - interval '2 minutes';
  select count(*) into v_anzahl from gast_aenderungen where sitzung = p_sitzung;
  if v_anzahl >= 10 then
    raise exception 'Limit erreicht: Gäste dürfen höchstens 10 Änderungen in 2 Minuten machen. Bitte kurz warten.';
  end if;
  insert into gast_aenderungen (sitzung) values (p_sitzung);
  return 10 - v_anzahl - 1;
end;
$$;
revoke execute on function gast_aenderung_zaehlen(uuid) from public, anon, authenticated;

-- ── Öffentliche Gast-Funktionen ──
create or replace function gast_sitzung_starten()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  delete from gast_sitzungen where erstellt < now() - interval '1 day';
  insert into gast_sitzungen default values returning id into v_id;
  return v_id;
end;
$$;

create or replace function gast_buchen(p_sitzung uuid, p_raum text, p_tisch text, p_start text, p_ende text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest int;
  v_id bigint;
begin
  v_rest := gast_aenderung_zaehlen(p_sitzung);
  perform set_config('rb.gast_rpc', 'on', true);
  insert into buchungen (raum, tisch, nutzer_id, name, start, ende, quelle, test, gast_sitzung)
  values (p_raum, nullif(p_tisch, ''), (select id from nutzer where name = 'Gast'), 'Gast',
          p_start, p_ende, 'web', true, p_sitzung)
  returning id into v_id;
  perform set_config('rb.gast_rpc', 'off', true);
  return jsonb_build_object('id', v_id, 'verbleibend', v_rest);
end;
$$;

create or replace function gast_buchung_loeschen(p_sitzung uuid, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest int;
begin
  v_rest := gast_aenderung_zaehlen(p_sitzung);
  delete from buchungen where id = p_id and test and gast_sitzung = p_sitzung;
  if not found then
    raise exception 'Gäste können nur ihre eigenen Test-Buchungen löschen.';
  end if;
  return jsonb_build_object('verbleibend', v_rest);
end;
$$;

create or replace function gast_etagen_laden(p_sitzung uuid)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select definition from gast_etagen
  where sitzung = p_sitzung and aktualisiert >= now() - interval '15 minutes'
  order by id;
$$;

create or replace function gast_etage_speichern(p_sitzung uuid, p_definition jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest int;
  v_id text := p_definition->>'id';
begin
  v_rest := gast_aenderung_zaehlen(p_sitzung);
  if jsonb_typeof(p_definition) is distinct from 'object' or v_id is null or v_id !~ '^[a-z0-9-]{1,60}$' then
    raise exception 'Ungültige Etagen-Definition oder ID.';
  end if;
  if jsonb_typeof(p_definition->'raeume') is distinct from 'array' or jsonb_array_length(p_definition->'raeume') = 0 then
    raise exception 'Die Etage braucht mindestens einen buchbaren Raum.';
  end if;
  if octet_length(p_definition::text) > 1500000 then
    raise exception 'Etage zu groß für das Testsystem (max. 1,5 MB inkl. Bild).';
  end if;
  if (select count(*) from gast_etagen where sitzung = p_sitzung and id <> v_id) >= 5 then
    raise exception 'Im Testsystem sind höchstens 5 eigene Etagen erlaubt.';
  end if;
  insert into gast_etagen (sitzung, id, definition) values (p_sitzung, v_id, p_definition)
  on conflict (sitzung, id) do update set definition = excluded.definition, aktualisiert = now();
  return jsonb_build_object('id', v_id, 'verbleibend', v_rest);
end;
$$;

create or replace function gast_etage_loeschen(p_sitzung uuid, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest int;
begin
  v_rest := gast_aenderung_zaehlen(p_sitzung);
  delete from gast_etagen where sitzung = p_sitzung and id = p_id;
  return jsonb_build_object('verbleibend', v_rest);
end;
$$;

-- Setzt NUR die Änderungen dieser Sitzung zurück (Buchungen + Etagen).
-- Der Änderungszähler bleibt bestehen, sonst ließe sich das Limit umgehen.
create or replace function gast_zuruecksetzen(p_sitzung uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buchungen int;
  v_etagen int;
begin
  delete from buchungen where test and gast_sitzung = p_sitzung;
  get diagnostics v_buchungen = row_count;
  delete from gast_etagen where sitzung = p_sitzung;
  get diagnostics v_etagen = row_count;
  return jsonb_build_object('buchungen', v_buchungen, 'etagen', v_etagen);
end;
$$;

-- Automatisches Aufräumen (wird von der Website regelmäßig aufgerufen)
create or replace function test_buchungen_aufraeumen()
returns void
language sql
security definer
set search_path = public
as $$
  delete from buchungen where test and erstellt < now() - interval '2 minutes';
  delete from gast_etagen where aktualisiert < now() - interval '15 minutes';
  delete from gast_aenderungen where zeit < now() - interval '2 minutes';
$$;

-- ── Admin: komplettes Testsystem leeren ──
create or replace function testsystem_leeren(p_admin_name text, p_admin_passwort text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_buchungen int;
  v_etagen int;
begin
  if not admin_pruefen(p_admin_name, p_admin_passwort) then
    raise exception 'Nur Administratoren dürfen das Testsystem leeren (Passwort falsch?).';
  end if;
  delete from buchungen where test;
  get diagnostics v_buchungen = row_count;
  delete from gast_etagen;
  get diagnostics v_etagen = row_count;
  delete from gast_aenderungen;
  return jsonb_build_object('buchungen', v_buchungen, 'etagen', v_etagen);
end;
$$;

revoke execute on function gast_sitzung_starten(), gast_buchen(uuid, text, text, text, text),
  gast_buchung_loeschen(uuid, bigint), gast_etagen_laden(uuid), gast_etage_speichern(uuid, jsonb),
  gast_etage_loeschen(uuid, text), gast_zuruecksetzen(uuid), testsystem_leeren(text, text) from public;
grant execute on function gast_sitzung_starten(), gast_buchen(uuid, text, text, text, text),
  gast_buchung_loeschen(uuid, bigint), gast_etagen_laden(uuid), gast_etage_speichern(uuid, jsonb),
  gast_etage_loeschen(uuid, text), gast_zuruecksetzen(uuid), testsystem_leeren(text, text),
  test_buchungen_aufraeumen() to anon, authenticated;
