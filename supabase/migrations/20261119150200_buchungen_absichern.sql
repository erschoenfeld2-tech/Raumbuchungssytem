-- ══════════════════════════════════════════════════════════
-- Buchungen serverseitig absichern
--
-- 1. erstellt wird immer von der Datenbank gesetzt (vorher konnte ein
--    Client über den anon key einen beliebigen Zeitpunkt mitschicken und
--    so Test-Buchungen dem 2-Minuten-Aufräumen entziehen).
-- 2. Derselbe Tisch kann nicht doppelt für überlappende Zeiten gebucht
--    werden – auch nicht, wenn zwei Browser gleichzeitig auf "Buchen"
--    klicken (die Prüfung im Frontend allein hat da eine Lücke).
--    Gilt getrennt für Echtbetrieb und Testsystem (Spalte test).
--    Die Raum-Kapazität kennt die DB nicht (Räume stehen in etagen/*.js),
--    die prüft weiterhin das Frontend bzw. die NFC-Brücke.
-- 3. Start muss vor Ende liegen.
-- ══════════════════════════════════════════════════════════

create or replace function buchungen_pruefen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.erstellt := now();
  else
    new.erstellt := old.erstellt;
  end if;

  if new.start >= new.ende then
    raise exception 'Startzeit muss vor Endzeit liegen.';
  end if;

  if new.tisch is not null then
    -- gleichzeitige Buchungen desselben Raums nacheinander prüfen
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

drop trigger if exists buchungen_pruefen on buchungen;
create trigger buchungen_pruefen
  before insert or update on buchungen
  for each row execute function buchungen_pruefen();

-- Schnellere Tages-/Überlappungsabfragen (index.html, NFC-Brücke)
create index if not exists buchungen_raum_start_idx on buchungen (raum, start);
create index if not exists buchungen_start_idx on buchungen (start);
