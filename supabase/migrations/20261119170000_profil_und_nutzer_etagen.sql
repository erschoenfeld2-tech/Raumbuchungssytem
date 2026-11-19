-- ══════════════════════════════════════════════════════════
-- Profil und Etagen für alle angemeldeten Nutzer
--
-- 1. Profil: Jeder angemeldete Nutzer kann Nutzername und Profilbild
--    ändern (profil_speichern, mit Passwortprüfung). Das Bild liegt als
--    kleine data-URL in nutzer.bild und wird – wie der Name – nur dem
--    Nutzer selbst ausgeliefert (über nutzer_login), nie anderen.
-- 2. Etagen-Editor im Echtbetrieb: Nicht nur der Admin, sondern jeder
--    angemeldete Nutzer darf Etagen anlegen. Diese sind dauerhaft und für
--    alle sichtbar (anders als Gast-Etagen: keine Sitzung, kein Verfallen).
--    Bearbeiten/Löschen darf der Ersteller (etagen.erstellt_von) und der
--    Admin. Die Parameternamen p_admin_* bleiben aus Kompatibilität
--    bestehen (create or replace kann sie nicht umbenennen) – gemeint ist
--    jetzt „angemeldeter Nutzer“.
--    Hinweis: Dass nur der Admin die Datei-Etagen (etagen/*.js) per
--    gleicher id ersetzt, prüft die Oberfläche; die Datenbank kennt die
--    Datei-Etagen nicht (gleiche bekannte Einschränkung wie in CLAUDE.md).
-- ══════════════════════════════════════════════════════════

-- ── Profilbild ──
alter table nutzer add column if not exists bild text;
alter table nutzer drop constraint if exists nutzer_bild_pruefen;
alter table nutzer add constraint nutzer_bild_pruefen check (
  bild is null or (length(bild) <= 300000 and bild ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')
);

-- Login liefert jetzt zusätzlich das eigene Profilbild (Rückgabetyp ändert
-- sich → Funktion neu anlegen)
drop function if exists nutzer_login(text, text);
create function nutzer_login(p_name text, p_passwort text)
returns table (id bigint, name text, ist_admin boolean, muss_aendern boolean, bild text)
language sql
security definer
set search_path = public, extensions
as $$
  select n.id, n.name, n.ist_admin, n.passwort_muss_aendern, n.bild
  from nutzer n
  where lower(n.name) = lower(p_name)
    and n.passwort_hash is not null
    and n.passwort_hash = crypt(p_passwort, n.passwort_hash);
$$;
revoke execute on function nutzer_login(text, text) from public;
grant execute on function nutzer_login(text, text) to anon, authenticated;

-- Prüft Name + Passwort eines angemeldeten Nutzers (intern), liefert die id
create or replace function nutzer_pruefen(p_name text, p_passwort text)
returns bigint
language sql
stable
security definer
set search_path = public, extensions
as $$
  select n.id from nutzer n
  where lower(n.name) = lower(p_name)
    and not n.passwort_muss_aendern
    and n.passwort_hash is not null
    and n.passwort_hash = crypt(p_passwort, n.passwort_hash);
$$;
revoke execute on function nutzer_pruefen(text, text) from public, anon, authenticated;

-- ── Profil speichern ──
-- p_neuer_name: null = Name bleibt. p_bild_aendern = true: p_bild übernehmen
-- (null = Bild entfernen). Liefert den neuen Stand (nur an den Nutzer selbst).
create or replace function profil_speichern(p_name text, p_passwort text, p_neuer_name text, p_bild_aendern boolean, p_bild text)
returns table (name text, bild text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id bigint := nutzer_pruefen(p_name, p_passwort);
  v_name text := btrim(p_neuer_name);
begin
  if v_id is null then
    raise exception 'Passwort falsch – Profil wurde nicht gespeichert.';
  end if;
  if v_name is not null and v_name <> (select n.name from nutzer n where n.id = v_id) then
    if length(v_name) < 2 or length(v_name) > 40 or v_name !~ '^[[:alnum:]ÄÖÜäöüß ._-]+$' then
      raise exception 'Der Nutzername muss 2–40 Zeichen lang sein (Buchstaben, Ziffern, Leerzeichen, . _ -).';
    end if;
    if lower(v_name) = 'gast' or exists (select 1 from nutzer n where lower(n.name) = lower(v_name) and n.id <> v_id) then
      raise exception 'Dieser Nutzername ist schon vergeben.';
    end if;
    update nutzer set name = v_name where id = v_id;
    update buchungen set name = v_name where nutzer_id = v_id;   -- Kopie des Namens nachziehen
  end if;
  if p_bild_aendern then
    update nutzer set bild = p_bild where id = v_id;   -- Format/Größe prüft der Check-Constraint
  end if;
  return query select n.name, n.bild from nutzer n where n.id = v_id;
end;
$$;
revoke execute on function profil_speichern(text, text, text, boolean, text) from public;
grant execute on function profil_speichern(text, text, text, boolean, text) to anon, authenticated;

-- ── Etagen für alle angemeldeten Nutzer ──
alter table etagen add column if not exists erstellt_von bigint references nutzer(id) on delete set null;

create or replace function etage_speichern(p_admin_name text, p_admin_passwort text, p_definition jsonb)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nutzer bigint := nutzer_pruefen(p_admin_name, p_admin_passwort);
  v_admin boolean;
  v_id text;
  v_besitzer bigint;
  v_doppelt text;
begin
  if v_nutzer is null then
    raise exception 'Nur angemeldete Nutzer dürfen Etagen speichern (Name/Passwort falsch?).';
  end if;
  select ist_admin into v_admin from nutzer where id = v_nutzer;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception 'Ungültige Etagen-Definition.';
  end if;
  if octet_length(p_definition::text) > 4000000 then
    raise exception 'Etage zu groß (max. 4 MB inkl. Bild) – bitte ein kleineres Bild verwenden.';
  end if;
  v_id := p_definition->>'id';
  if v_id is null or v_id !~ '^[a-z0-9-]{1,60}$' then
    raise exception 'Ungültige Etagen-ID (erlaubt: a–z, 0–9, Bindestrich).';
  end if;
  if jsonb_typeof(p_definition->'raeume') is distinct from 'array'
     or jsonb_array_length(p_definition->'raeume') = 0 then
    raise exception 'Die Etage braucht mindestens einen buchbaren Raum.';
  end if;
  select erstellt_von into v_besitzer from etagen where id = v_id;
  if found and not v_admin and v_besitzer is distinct from v_nutzer then
    raise exception 'Diese Etage hat jemand anderes angelegt – nur der Ersteller oder der Admin darf sie ändern.';
  end if;
  select r->>'name' into v_doppelt
  from etagen e, jsonb_array_elements(e.definition->'raeume') r
  where e.id <> v_id
    and r->>'name' in (select x->>'name' from jsonb_array_elements(p_definition->'raeume') x)
  limit 1;
  if v_doppelt is not null then
    raise exception 'Raumname "%" gibt es schon in einer anderen Etage.', v_doppelt;
  end if;

  insert into etagen (id, definition, erstellt_von) values (v_id, p_definition, v_nutzer)
  on conflict (id) do update set definition = excluded.definition, aktualisiert = now();
  return v_id;
end;
$$;

create or replace function etage_loeschen(p_admin_name text, p_admin_passwort text, p_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nutzer bigint := nutzer_pruefen(p_admin_name, p_admin_passwort);
begin
  if v_nutzer is null then
    raise exception 'Nur angemeldete Nutzer dürfen Etagen löschen (Name/Passwort falsch?).';
  end if;
  delete from etagen
  where id = p_id
    and (erstellt_von = v_nutzer or (select ist_admin from nutzer where id = v_nutzer));
  if not found then
    raise exception 'Nur der Ersteller oder der Admin darf diese Etage löschen.';
  end if;
end;
$$;
