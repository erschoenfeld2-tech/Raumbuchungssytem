-- ══════════════════════════════════════════════════════════
-- Testsystem: Jeder Gast bekommt eine Nummer (Gast 1, Gast 2, …)
--
-- Alle Gäste sehen die Test-Buchungen der anderen. Damit man sie
-- unterscheiden kann, trägt jede Gast-Sitzung eine fortlaufende Nummer ab 1
-- (kleinste freie Zahl über der höchsten vergebenen, d.h. nach dem
-- Aufräumen alter Sitzungen bzw. nach testsystem_leeren() beginnt es wieder
-- bei 1). Die Nummer ist kein Name und verrät nichts über die geheime
-- Sitzung – sie darf daher öffentlich lesbar sein (buchungen.gast_nr).
--
--   • gast_sitzungen.nummer       – Nummer der Sitzung
--   • buchungen.gast_nr           – Kopie bei Test-Buchungen (per Trigger,
--                                   nicht von außen setz- oder änderbar)
--   • gast_nummer(p_sitzung)      – eigene Nummer (null = Sitzung weg)
--   • testsystem_leeren()         – löscht jetzt auch alle Sitzungen, damit
--                                   die Nummerierung wieder bei 1 beginnt
-- ══════════════════════════════════════════════════════════

alter table gast_sitzungen add column if not exists nummer int;
alter table buchungen add column if not exists gast_nr int;

-- Bestehende Sitzungen nachträglich durchnummerieren (nur noch nicht nummerierte)
update gast_sitzungen s set nummer = x.nr
from (select id, (select coalesce(max(nummer), 0) from gast_sitzungen) + row_number() over (order by erstellt, id) as nr
      from gast_sitzungen where nummer is null) x
where s.id = x.id;
-- Bestehende Test-Buchungen nachziehen (vor dem Trigger unten, der gast_nr sonst festhält)
update buchungen b set gast_nr = s.nummer
from gast_sitzungen s
where b.test and b.gast_sitzung = s.id and b.gast_nr is distinct from s.nummer;

grant select (gast_nr) on buchungen to anon, authenticated;

-- gast_nr kommt immer aus der Sitzung – nie vom Aufrufer. security definer,
-- weil anon gast_sitzungen nicht lesen darf (sonst käme bei verbotenen
-- direkten Test-Inserts "permission denied" statt der Meldung aus buchungen_pruefen).
create or replace function buchungen_gast_nr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.gast_nr := case when new.test and new.gast_sitzung is not null
                        then (select nummer from gast_sitzungen where id = new.gast_sitzung) end;
  else
    new.gast_nr := old.gast_nr;
  end if;
  return new;
end;
$$;
drop trigger if exists buchungen_gast_nr on buchungen;
create trigger buchungen_gast_nr
  before insert or update on buchungen
  for each row execute function buchungen_gast_nr();

-- Neue Sitzung mit der nächsten Nummer (Sperre gegen doppelte Nummern bei
-- gleichzeitigem Start). Signatur unverändert, liefert weiter die Sitzungs-ID.
create or replace function gast_sitzung_starten()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('gast_nummer'));
  delete from gast_sitzungen where erstellt < now() - interval '1 day';
  insert into gast_sitzungen (nummer)
  values ((select coalesce(max(nummer), 0) + 1 from gast_sitzungen))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function gast_nummer(p_sitzung uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select nummer from gast_sitzungen where id = p_sitzung;
$$;
revoke execute on function gast_nummer(uuid) from public;
grant execute on function gast_nummer(uuid) to anon, authenticated;

-- Admin: komplettes Testsystem leeren – inkl. aller Sitzungen, damit die
-- Nummerierung wieder bei 1 beginnt (offene Gast-Fenster holen sich beim
-- nächsten Laden bzw. Schreiben automatisch eine neue Sitzung).
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
  delete from gast_sitzungen;
  return jsonb_build_object('buchungen', v_buchungen, 'etagen', v_etagen);
end;
$$;
