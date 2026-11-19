-- ══════════════════════════════════════════════════════════
-- Admin-Passwort aus dem Frontend in die Datenbank verschieben
--
-- Bisher stand das Admin-Passwort im Klartext in index.html (öffentliches
-- Repo, öffentliche Website) – jeder konnte sich als Admin anmelden.
-- Ab jetzt meldet sich der Admin wie alle anderen über nutzer_login() an
-- (bcrypt-Hash in nutzer.passwort_hash, nie über nutzer_public sichtbar).
--
-- Übergang: Der Hash wird einmalig aus dem bisherigen (bekannten, daher
-- unsicheren) Passwort erzeugt und passwort_muss_aendern = true gesetzt –
-- beim nächsten Admin-Login muss also sofort ein neues Passwort vergeben
-- werden. Ein bereits gesetzter Hash wird nicht überschrieben.
-- ══════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

update nutzer
set passwort_hash = extensions.crypt('System-2026!', extensions.gen_salt('bf')),
    passwort_muss_aendern = true
where ist_admin and passwort_hash is null;

-- Login jetzt auch für Admins (vorher: "and not n.ist_admin")
create or replace function nutzer_login(p_name text, p_passwort text)
returns table (id bigint, name text, ist_admin boolean, muss_aendern boolean)
language sql
security definer
set search_path = public, extensions
as $$
  select n.id, n.name, n.ist_admin, n.passwort_muss_aendern
  from nutzer n
  where lower(n.name) = lower(p_name)
    and n.passwort_hash is not null
    and n.passwort_hash = crypt(p_passwort, n.passwort_hash);
$$;

-- Passwortwechsel jetzt auch für Admins
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
