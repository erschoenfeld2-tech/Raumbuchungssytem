-- ══════════════════════════════════════════════════════════
-- Etagen/Gebäude in der Datenbank (Etagen-Editor im Frontend)
--
-- Etagen können weiterhin als Datei in etagen/*.js liegen. Zusätzlich kann
-- ein Admin im Browser neue Etagen/Gebäude anlegen (Grundriss-Bild hochladen
-- oder JSON-Datei importieren, Räume aufziehen). Diese landen hier.
-- Eine DB-Etage mit derselben id ersetzt im Frontend die Datei-Etage.
--
-- Rechte: Lesen darf jeder (die Website braucht die Grundrisse).
-- Schreiben NUR über etage_speichern()/etage_loeschen(), die das
-- Admin-Passwort serverseitig gegen den bcrypt-Hash prüfen – ein direktes
-- insert/update/delete mit dem öffentlichen anon key ist gesperrt.
-- ══════════════════════════════════════════════════════════

create table if not exists etagen (
  id text primary key check (id ~ '^[a-z0-9-]{1,60}$'),
  definition jsonb not null,
  aktualisiert timestamptz not null default now()
);

alter table etagen enable row level security;
drop policy if exists "etagen_select" on etagen;
create policy "etagen_select" on etagen for select using (true);
grant select on etagen to anon, authenticated;
revoke insert, update, delete, truncate on etagen from anon, authenticated;

-- Prüft Admin-Name + Passwort (nur intern, nicht für anon aufrufbar)
create or replace function admin_pruefen(p_name text, p_passwort text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from nutzer n
    where lower(n.name) = lower(p_name)
      and n.ist_admin
      and not n.passwort_muss_aendern
      and n.passwort_hash is not null
      and n.passwort_hash = crypt(p_passwort, n.passwort_hash)
  );
$$;
revoke execute on function admin_pruefen(text, text) from public, anon, authenticated;

-- Speichert (oder ersetzt) eine Etage. Gibt die id zurück.
create or replace function etage_speichern(p_admin_name text, p_admin_passwort text, p_definition jsonb)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text;
  v_doppelt text;
begin
  if not admin_pruefen(p_admin_name, p_admin_passwort) then
    raise exception 'Nur Administratoren dürfen Etagen speichern (Name/Passwort falsch?).';
  end if;
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
  -- Raumnamen müssen systemweit eindeutig sein (buchungen.raum speichert nur den Namen).
  -- Datei-Etagen prüft das Frontend, hier die übrigen DB-Etagen.
  select r->>'name' into v_doppelt
  from etagen e, jsonb_array_elements(e.definition->'raeume') r
  where e.id <> v_id
    and r->>'name' in (select x->>'name' from jsonb_array_elements(p_definition->'raeume') x)
  limit 1;
  if v_doppelt is not null then
    raise exception 'Raumname "%" gibt es schon in einer anderen Etage.', v_doppelt;
  end if;

  insert into etagen (id, definition) values (v_id, p_definition)
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
begin
  if not admin_pruefen(p_admin_name, p_admin_passwort) then
    raise exception 'Nur Administratoren dürfen Etagen löschen (Name/Passwort falsch?).';
  end if;
  delete from etagen where id = p_id;
end;
$$;

revoke execute on function etage_speichern(text, text, jsonb) from public;
revoke execute on function etage_loeschen(text, text, text) from public;
grant execute on function etage_speichern(text, text, jsonb) to anon, authenticated;
grant execute on function etage_loeschen(text, text, text) to anon, authenticated;
