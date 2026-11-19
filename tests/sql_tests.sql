-- ══════════════════════════════════════════════════════════
-- Verhaltenstests für die Migrationen. Laufen in einer frischen
-- Test-Datenbank (tests/run_tests.sh), NIE gegen die echte DB.
-- Alles läuft als Rolle anon – also genau mit den Rechten, die die
-- Website und die NFC-Brücke über den öffentlichen anon key haben.
-- Jeder Test bricht bei Fehlschlag mit "TEST FEHLGESCHLAGEN" ab.
-- ══════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
set role anon;

-- Hilfsfunktion: erwartet, dass ein SQL-Befehl mit einer Fehlermeldung scheitert
reset role;
create or replace function pg_temp.muss_scheitern(p_sql text, p_text text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_text in sqlerrm) = 0 then
      raise exception 'TEST FEHLGESCHLAGEN: erwartete Meldung "%" bei [%], bekam "%"', p_text, p_sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'TEST FEHLGESCHLAGEN: [%] hätte scheitern müssen', p_sql;
end $$;
grant execute on function pg_temp.muss_scheitern(text, text) to anon;
set role anon;

-- 1. nfc_uid bleibt geschützt: Basistabelle nutzer ist für anon nicht lesbar
do $$ begin
  if (select count(*) from nutzer) <> 0 then raise exception 'TEST FEHLGESCHLAGEN: anon kann nutzer lesen'; end if;
  if (select count(*) from nutzer_public where name = 'Gast') <> 1 then raise exception 'TEST FEHLGESCHLAGEN: Gast fehlt'; end if;
end $$;

-- 2. Admin-Login läuft über die DB; Startpasswort muss geändert werden
do $$ declare r record; begin
  select * into r from nutzer_login('admin_universal', 'System-2026!');
  if r.id is null or not r.ist_admin or not r.muss_aendern then raise exception 'TEST FEHLGESCHLAGEN: Admin-Login %', r; end if;
  if exists (select 1 from nutzer_login('Admin_Universal', 'falsch')) then raise exception 'TEST FEHLGESCHLAGEN: falsches Passwort akzeptiert'; end if;
  if exists (select 1 from nutzer_login('Gast', '')) then raise exception 'TEST FEHLGESCHLAGEN: Gast kann sich mit Passwort anmelden'; end if;
end $$;
select pg_temp.muss_scheitern($$select admin_pruefen('Admin_Universal','System-2026!')$$, 'permission denied');
-- solange das Startpasswort nicht geändert ist, darf der Admin keine Etagen speichern
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','System-2026!','{"id":"x","raeume":[{"name":"A"}]}')$$, 'Nur Administratoren');
do $$ begin
  if not nutzer_passwort_aendern('Admin_Universal', 'System-2026!', 'NeuesAdminPW1') then raise exception 'TEST FEHLGESCHLAGEN: Admin-Passwortwechsel'; end if;
  if exists (select 1 from nutzer_login('Admin_Universal', 'System-2026!')) then raise exception 'TEST FEHLGESCHLAGEN: altes Admin-Passwort gilt noch'; end if;
  if (select muss_aendern from nutzer_login('Admin_Universal', 'NeuesAdminPW1')) then raise exception 'TEST FEHLGESCHLAGEN: muss_aendern bleibt true'; end if;
end $$;

-- 3. Etagen: lesen ja, direkt schreiben nein, über RPC nur mit Admin-Passwort
select pg_temp.muss_scheitern($$insert into etagen (id, definition) values ('hack', '{}')$$, 'permission denied');
select pg_temp.muss_scheitern($$select etage_speichern('Marie','123','{"id":"x","raeume":[{"name":"A"}]}')$$, 'Nur Administratoren');
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','NeuesAdminPW1','{"id":"Böse ID","raeume":[{"name":"A"}]}')$$, 'Ungültige Etagen-ID');
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','NeuesAdminPW1','{"id":"leer","raeume":[]}')$$, 'mindestens einen');
do $$ begin
  if etage_speichern('Admin_Universal', 'NeuesAdminPW1',
     '{"id":"werkstatt-1","gebaeude":"Werkstatt","nr":1,"raeume":[{"name":"Werkbank 1","typ":"sharedesk","tische":4,"x":10,"y":10,"w":200,"h":100}]}') <> 'werkstatt-1'
  then raise exception 'TEST FEHLGESCHLAGEN: etage_speichern'; end if;
  -- erneutes Speichern ersetzt die Etage
  perform etage_speichern('Admin_Universal', 'NeuesAdminPW1',
     '{"id":"werkstatt-1","gebaeude":"Werkstatt","nr":1,"name":"EG","raeume":[{"name":"Werkbank 1","typ":"sharedesk","tische":6,"x":10,"y":10,"w":200,"h":100}]}');
  if (select definition->>'name' from etagen where id = 'werkstatt-1') <> 'EG' then raise exception 'TEST FEHLGESCHLAGEN: Etage nicht ersetzt'; end if;
  if (select count(*) from etagen) <> 1 then raise exception 'TEST FEHLGESCHLAGEN: Etage doppelt'; end if;
end $$;
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','NeuesAdminPW1','{"id":"werkstatt-2","raeume":[{"name":"Werkbank 1"}]}')$$, 'gibt es schon');
select pg_temp.muss_scheitern($$select etage_loeschen('Marie','123','werkstatt-1')$$, 'Nur Administratoren');
do $$ begin
  perform etage_loeschen('Admin_Universal', 'NeuesAdminPW1', 'werkstatt-1');
  if exists (select 1 from etagen) then raise exception 'TEST FEHLGESCHLAGEN: Etage nicht gelöscht'; end if;
end $$;

-- 4. Buchungen: Tisch-Doppelbuchung wird von der DB abgewiesen
insert into buchungen (raum, tisch, nutzer_id, name, start, ende, quelle)
  values ('ShareDesk 1', '1.301', 1, 'Marie', '2030-01-01 09:00', '2030-01-01 10:00', 'web');
select pg_temp.muss_scheitern($$insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.301',2,'David Mayer','2030-01-01 09:30','2030-01-01 11:00')$$, 'bereits belegt');
select pg_temp.muss_scheitern($$insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.302',2,'David Mayer','2030-01-01 11:00','2030-01-01 10:00')$$, 'Startzeit muss vor Endzeit');
do $$ begin
  -- anderer Tisch, anschließende Zeit, Testsystem und NFC (ohne Tisch) sind erlaubt
  insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.302',2,'David Mayer','2030-01-01 09:30','2030-01-01 11:00');
  insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.301',2,'David Mayer','2030-01-01 10:00','2030-01-01 11:00');
  insert into buchungen (raum, tisch, nutzer_id, name, start, ende, test) values ('ShareDesk 1','1.301',(select id from nutzer_public where name = 'Gast'),'Gast','2030-01-01 09:00','2030-01-01 10:00', true);
  insert into buchungen (raum, nutzer_id, name, start, ende, quelle) values ('Besprechungsraum',1,'Marie','2030-01-01 09:00','2030-01-01 10:00','nfc');
  -- Verlängern (NFC-Brücke) und Verschieben der eigenen Buchung kollidieren nicht mit sich selbst
  update buchungen set ende = '2030-01-01 10:30' where raum = 'Besprechungsraum';
  update buchungen set ende = '2030-01-01 09:59' where tisch = '1.301' and start = '2030-01-01 09:00' and not test;
end $$;

-- 5. erstellt setzt immer die DB (kein Umgehen des 2-Minuten-Aufräumens)
insert into buchungen (raum, tisch, nutzer_id, name, start, ende, test, erstellt)
  values ('ShareDesk 2', '1.401', (select id from nutzer_public where name = 'Gast'), 'Gast', '2030-01-01 09:00', '2030-01-01 10:00', true, '2099-01-01');
do $$ begin
  if (select erstellt from buchungen where raum = 'ShareDesk 2') > now() + interval '1 minute' then
    raise exception 'TEST FEHLGESCHLAGEN: erstellt vom Client übernommen';
  end if;
  update buchungen set erstellt = '2099-01-01' where raum = 'ShareDesk 2';
  if (select erstellt from buchungen where raum = 'ShareDesk 2') > now() + interval '1 minute' then
    raise exception 'TEST FEHLGESCHLAGEN: erstellt per update änderbar';
  end if;
end $$;

-- 6. Aufräumen löscht nur alte Test-Buchungen
reset role;
update buchungen set erstellt = now() - interval '5 minutes' where test;   -- als Owner: Trigger hält erstellt fest …
alter table buchungen disable trigger buchungen_pruefen;
update buchungen set erstellt = now() - interval '5 minutes' where test;   -- … daher kurz ohne Trigger
alter table buchungen enable trigger buchungen_pruefen;
set role anon;
do $$ declare vorher int; begin
  select count(*) into vorher from buchungen where not test;
  perform test_buchungen_aufraeumen();
  if exists (select 1 from buchungen where test) then raise exception 'TEST FEHLGESCHLAGEN: Test-Buchungen nicht gelöscht'; end if;
  if (select count(*) from buchungen where not test) <> vorher then raise exception 'TEST FEHLGESCHLAGEN: echte Buchungen gelöscht'; end if;
end $$;

reset role;
delete from buchungen where start like '2030-%';
\echo '✓ Alle SQL-Tests bestanden'
