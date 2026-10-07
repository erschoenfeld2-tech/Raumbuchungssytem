-- ══════════════════════════════════════════════════════════
-- Echte Nutzernamen + persönliche Passwörter mit Zwangswechsel
--
-- 1. Testnutzer auf die echten Namen umbenennen (die ids bleiben,
--    bestehende Buchungen bleiben also zugeordnet).
-- 2. Pro Nutzer ein eigenes Passwort (bcrypt-Hash in nutzer, nie über
--    nutzer_public sichtbar). Startpasswort ist weiterhin '123' und
--    muss beim nächsten Login geändert werden.
-- 3. Login und Passwortwechsel laufen über security-definer-RPCs, damit
--    der anon key nie den Hash lesen kann (gleiches Prinzip wie
--    nutzer_by_nfc).
--
-- Der Admin (Admin_Universal) bleibt unverändert beim Passwort im Frontend.
-- ══════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- 1. Umbenennen (nutzer.name ist unique -> nur wenn Zielname frei ist)
update nutzer set name = 'Eric Schoenfeld'
where name = 'Eric Nicefield'
  and not exists (select 1 from nutzer where name = 'Eric Schoenfeld');
update nutzer set name = 'Dion Himaj'
where name = 'Dion Müller'
  and not exists (select 1 from nutzer where name = 'Dion Himaj');
update nutzer set name = 'David Mayer'
where name = 'Familienvater Mayer'
  and not exists (select 1 from nutzer where name = 'David Mayer');

-- buchungen.name ist eine Kopie des Nutzernamens -> nachziehen
update buchungen b set name = n.name
from nutzer n
where b.nutzer_id = n.id and b.name <> n.name;

-- 2. Passwortspalten
alter table nutzer add column if not exists passwort_hash text;
alter table nutzer add column if not exists passwort_muss_aendern boolean not null default true;

update nutzer
set passwort_hash = extensions.crypt('123', extensions.gen_salt('bf')),
    passwort_muss_aendern = true
where passwort_hash is null and not ist_admin;

-- 3. Login: liefert genau eine Zeile bei richtigem Passwort, sonst nichts
create or replace function nutzer_login(p_name text, p_passwort text)
returns table (id bigint, name text, ist_admin boolean, muss_aendern boolean)
language sql
security definer
set search_path = public, extensions
as $$
  select n.id, n.name, n.ist_admin, n.passwort_muss_aendern
  from nutzer n
  where lower(n.name) = lower(p_name)
    and not n.ist_admin
    and n.passwort_hash is not null
    and n.passwort_hash = crypt(p_passwort, n.passwort_hash);
$$;

-- Passwortwechsel: altes Passwort muss stimmen, neues mind. 6 Zeichen
-- und nicht das Startpasswort
create or replace function nutzer_passwort_aendern(p_name text, p_altes text, p_neues text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id bigint;
begin
  if p_neues is null or length(p_neues) < 6 then
    raise exception 'Das neue Passwort muss mindestens 6 Zeichen lang sein.';
  end if;
  if p_neues = '123' or p_neues = p_altes then
    raise exception 'Das neue Passwort muss sich vom alten unterscheiden.';
  end if;
  select n.id into v_id from nutzer n
  where lower(n.name) = lower(p_name)
    and not n.ist_admin
    and n.passwort_hash is not null
    and n.passwort_hash = crypt(p_altes, n.passwort_hash);
  if v_id is null then
    return false;
  end if;
  update nutzer
  set passwort_hash = crypt(p_neues, gen_salt('bf')), passwort_muss_aendern = false
  where id = v_id;
  return true;
end;
$$;

grant execute on function nutzer_login(text, text) to anon, authenticated;
grant execute on function nutzer_passwort_aendern(text, text, text) to anon, authenticated;
