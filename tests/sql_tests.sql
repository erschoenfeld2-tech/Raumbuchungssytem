-- ══════════════════════════════════════════════════════════
-- Verhaltenstests für die Migrationen. Laufen in einer frischen
-- Test-Datenbank (tests/run_tests.sh), NIE gegen die echte DB.
-- Alles läuft als Rolle anon – also genau mit den Rechten, die die
-- Website und die NFC-Brücke über den öffentlichen anon key haben.
-- Jeder Test bricht bei Fehlschlag mit "TEST FEHLGESCHLAGEN" ab.
-- ══════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1

-- Hilfsfunktion: erwartet, dass ein SQL-Befehl mit einer bestimmten Meldung scheitert
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

-- 1. Datenschutz: keine Nutzernamen, keine Karten-UIDs, keine Sitzungs-IDs über den anon key
select pg_temp.muss_scheitern($$select name from nutzer_public$$, 'permission denied');
select pg_temp.muss_scheitern($$select name from buchungen$$, 'permission denied');
select pg_temp.muss_scheitern($$select * from buchungen$$, 'permission denied');
select pg_temp.muss_scheitern($$select gast_sitzung from buchungen$$, 'permission denied');
select pg_temp.muss_scheitern($$select * from gast_etagen$$, 'permission denied');
do $$ begin
  if (select count(*) from nutzer) <> 0 then raise exception 'TEST FEHLGESCHLAGEN: anon kann nutzer lesen'; end if;
  perform id, raum, tisch, nutzer_id, start, ende, quelle, test, erstellt, gast_hash from buchungen;   -- erlaubte Spalten
end $$;

-- 2. Admin-Login läuft über die DB; Startpasswort muss geändert werden
do $$ declare r record; begin
  select * into r from nutzer_login('admin_universal', 'System-2026!');
  if r.id is null or not r.ist_admin or not r.muss_aendern then raise exception 'TEST FEHLGESCHLAGEN: Admin-Login %', r; end if;
  if exists (select 1 from nutzer_login('Admin_Universal', 'falsch')) then raise exception 'TEST FEHLGESCHLAGEN: falsches Passwort akzeptiert'; end if;
  if exists (select 1 from nutzer_login('Gast', '')) then raise exception 'TEST FEHLGESCHLAGEN: Gast kann sich mit Passwort anmelden'; end if;
end $$;
select pg_temp.muss_scheitern($$select admin_pruefen('Admin_Universal','System-2026!')$$, 'permission denied');
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','System-2026!','{"id":"x","raeume":[{"name":"A"}]}')$$, 'Nur angemeldete Nutzer');
do $$ begin
  if not nutzer_passwort_aendern('Admin_Universal', 'System-2026!', 'NeuesAdminPW1') then raise exception 'TEST FEHLGESCHLAGEN: Admin-Passwortwechsel'; end if;
  if exists (select 1 from nutzer_login('Admin_Universal', 'System-2026!')) then raise exception 'TEST FEHLGESCHLAGEN: altes Admin-Passwort gilt noch'; end if;
  if (select muss_aendern from nutzer_login('Admin_Universal', 'NeuesAdminPW1')) then raise exception 'TEST FEHLGESCHLAGEN: muss_aendern bleibt true'; end if;
end $$;

-- 3. Etagen: lesen ja, direkt schreiben nein, über RPC nur mit Admin-Passwort
select pg_temp.muss_scheitern($$insert into etagen (id, definition) values ('hack', '{}')$$, 'permission denied');
select pg_temp.muss_scheitern($$select etage_speichern('Marie','123','{"id":"x","raeume":[{"name":"A"}]}')$$, 'Nur angemeldete Nutzer');
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','NeuesAdminPW1','{"id":"Böse ID","raeume":[{"name":"A"}]}')$$, 'Ungültige Etagen-ID');
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','NeuesAdminPW1','{"id":"leer","raeume":[]}')$$, 'mindestens einen');
do $$ begin
  if etage_speichern('Admin_Universal', 'NeuesAdminPW1',
     '{"id":"werkstatt-1","gebaeude":"Werkstatt","nr":1,"raeume":[{"name":"Werkbank 1","typ":"sharedesk","tische":4,"x":10,"y":10,"w":200,"h":100}]}') <> 'werkstatt-1'
  then raise exception 'TEST FEHLGESCHLAGEN: etage_speichern'; end if;
  perform etage_speichern('Admin_Universal', 'NeuesAdminPW1',
     '{"id":"werkstatt-1","gebaeude":"Werkstatt","nr":1,"name":"EG","raeume":[{"name":"Werkbank 1","typ":"sharedesk","tische":6,"x":10,"y":10,"w":200,"h":100}]}');
  if (select definition->>'name' from etagen where id = 'werkstatt-1') <> 'EG' then raise exception 'TEST FEHLGESCHLAGEN: Etage nicht ersetzt'; end if;
  if (select count(*) from etagen) <> 1 then raise exception 'TEST FEHLGESCHLAGEN: Etage doppelt'; end if;
end $$;
select pg_temp.muss_scheitern($$select etage_speichern('Admin_Universal','NeuesAdminPW1','{"id":"werkstatt-2","raeume":[{"name":"Werkbank 1"}]}')$$, 'gibt es schon');
select pg_temp.muss_scheitern($$select etage_loeschen('Marie','123','werkstatt-1')$$, 'Nur angemeldete Nutzer');
do $$ begin
  perform etage_loeschen('Admin_Universal', 'NeuesAdminPW1', 'werkstatt-1');
  if exists (select 1 from etagen) then raise exception 'TEST FEHLGESCHLAGEN: Etage nicht gelöscht'; end if;
end $$;

-- 4. Buchungen: Tisch-Doppelbuchung wird von der DB abgewiesen
insert into buchungen (raum, tisch, nutzer_id, name, start, ende, quelle)
  values ('ShareDesk 1', '1.301', 1, 'Marie', '2030-01-01 09:00', '2030-01-01 10:00', 'web');
select pg_temp.muss_scheitern($$insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.301',2,'David Mayer','2030-01-01 09:30','2030-01-01 11:00')$$, 'bereits belegt');
select pg_temp.muss_scheitern($$insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.302',2,'David Mayer','2030-01-01 11:00','2030-01-01 10:00')$$, 'Startzeit muss vor Endzeit');
-- Test-Buchungen nur über gast_buchen(), nicht per direktem Insert
select pg_temp.muss_scheitern($$insert into buchungen (raum, tisch, nutzer_id, name, start, ende, test) values ('ShareDesk 1','1.302',1,'x','2030-01-01 09:00','2030-01-01 10:00', true)$$, 'nur über das Testsystem');
do $$ begin
  insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.302',2,'David Mayer','2030-01-01 09:30','2030-01-01 11:00');
  insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 1','1.301',2,'David Mayer','2030-01-01 10:00','2030-01-01 11:00');
  insert into buchungen (raum, nutzer_id, name, start, ende, quelle) values ('Besprechungsraum',1,'Marie','2030-01-01 09:00','2030-01-01 10:00','nfc');
  update buchungen set ende = '2030-01-01 10:30' where raum = 'Besprechungsraum';
  update buchungen set ende = '2030-01-01 09:59' where tisch = '1.301' and start = '2030-01-01 09:00' and not test;
end $$;
select pg_temp.muss_scheitern($$update buchungen set test = true where raum = 'Besprechungsraum'$$, 'nicht änderbar');

-- 5. erstellt setzt immer die DB
insert into buchungen (raum, tisch, nutzer_id, name, start, ende, erstellt)
  values ('ShareDesk 2', '1.401', 1, 'Marie', '2030-01-01 09:00', '2030-01-01 10:00', '2099-01-01');
do $$ begin
  if (select erstellt from buchungen where raum = 'ShareDesk 2') > now() + interval '1 minute' then
    raise exception 'TEST FEHLGESCHLAGEN: erstellt vom Client übernommen';
  end if;
  update buchungen set erstellt = '2099-01-01' where raum = 'ShareDesk 2';
  if (select erstellt from buchungen where raum = 'ShareDesk 2') > now() + interval '1 minute' then
    raise exception 'TEST FEHLGESCHLAGEN: erstellt per update änderbar';
  end if;
end $$;

-- 6. Gast-Sitzungen: eigene Buchungen, Limit, private Etagen, Zurücksetzen
create temp table s (name text, id uuid);
grant all on s to anon;
insert into s select 'a', gast_sitzung_starten();
insert into s select 'b', gast_sitzung_starten();
select pg_temp.muss_scheitern($$select gast_buchen(gen_random_uuid(), 'ShareDesk 3', '1.501', '2030-01-01 09:00', '2030-01-01 10:00')$$, 'Sitzung abgelaufen');
do $$
declare a uuid := (select id from s where name = 'a'); b uuid := (select id from s where name = 'b'); r jsonb; ida bigint; idb bigint;
begin
  r := gast_buchen(a, 'ShareDesk 3', '1.501', '2030-01-01 09:00', '2030-01-01 10:00');
  ida := (r->>'id')::bigint;
  if (r->>'verbleibend')::int <> 9 then raise exception 'TEST FEHLGESCHLAGEN: verbleibend %', r; end if;
  idb := (gast_buchen(b, 'ShareDesk 3', '1.501', '2030-01-01 10:00', '2030-01-01 11:00')->>'id')::bigint;
  -- Hash ist lesbar und entspricht SHA-256 der Sitzung (so erkennt der Browser eigene Buchungen)
  if (select gast_hash from buchungen where id = ida) <> encode(sha256(a::text::bytea), 'hex') then raise exception 'TEST FEHLGESCHLAGEN: gast_hash'; end if;
  -- fremde Test-Buchung darf ein Gast nicht löschen
  begin
    perform gast_buchung_loeschen(a, idb);
    raise exception 'TEST FEHLGESCHLAGEN: fremde Buchung gelöscht';
  exception when others then
    if sqlerrm not like '%nur ihre eigenen%' then raise; end if;
  end;
  -- Etagen sind privat je Sitzung
  perform gast_etage_speichern(a, '{"id":"gast-test","raeume":[{"name":"Gastraum A"}]}');
  if (select count(*) from gast_etagen_laden(a)) <> 1 then raise exception 'TEST FEHLGESCHLAGEN: eigene Gast-Etage fehlt'; end if;
  if (select count(*) from gast_etagen_laden(b)) <> 0 then raise exception 'TEST FEHLGESCHLAGEN: fremde Gast-Etage sichtbar'; end if;
  -- Zurücksetzen: nur Sitzung a
  r := gast_zuruecksetzen(a);
  if r <> '{"buchungen": 1, "etagen": 1}'::jsonb then raise exception 'TEST FEHLGESCHLAGEN: zurücksetzen %', r; end if;
  if not exists (select 1 from buchungen where id = idb) then raise exception 'TEST FEHLGESCHLAGEN: fremde Buchung zurückgesetzt'; end if;
  if (select count(*) from gast_etagen_laden(a)) <> 0 then raise exception 'TEST FEHLGESCHLAGEN: Etage nicht zurückgesetzt'; end if;
end $$;
-- Limit: Sitzung a hat 2 Änderungen gezählt (1 Buchung, 1 Etage; das gescheiterte Löschen
-- wurde zurückgerollt, Zurücksetzen zählt nicht) → noch 8 erlaubt, die 9. scheitert
do $$ declare a uuid := (select id from s where name = 'a'); i int; begin
  for i in 1..8 loop
    perform gast_buchen(a, 'ShareDesk 4', null, '2030-01-02 ' || lpad((8 + i)::text, 2, '0') || ':00', '2030-01-02 ' || lpad((8 + i)::text, 2, '0') || ':30');
  end loop;
end $$;
select pg_temp.muss_scheitern($$select gast_buchen((select id from s where name = 'a'), 'ShareDesk 4', null, '2030-01-03 09:00', '2030-01-03 10:00')$$, 'höchstens 10 Änderungen');
-- Sitzung b ist vom Limit von a nicht betroffen
select gast_buchen((select id from s where name = 'b'), 'ShareDesk 4', null, '2030-01-03 09:00', '2030-01-03 10:00');

-- 7. Admin leert das komplette Testsystem
select pg_temp.muss_scheitern($$select testsystem_leeren('Marie','123')$$, 'Nur Administratoren');
do $$ declare r jsonb; vorher int; begin
  select count(*) into vorher from buchungen where not test;
  r := testsystem_leeren('Admin_Universal', 'NeuesAdminPW1');
  if (r->>'buchungen')::int < 2 then raise exception 'TEST FEHLGESCHLAGEN: leeren %', r; end if;
  if exists (select 1 from buchungen where test) then raise exception 'TEST FEHLGESCHLAGEN: Test-Buchungen übrig'; end if;
  if (select count(*) from buchungen where not test) <> vorher then raise exception 'TEST FEHLGESCHLAGEN: echte Buchungen gelöscht'; end if;
end $$;

-- 8. Automatisches Aufräumen löscht nur alte Test-Daten
select gast_buchen((select id from s where name = 'b'), 'ShareDesk 5', null, '2030-01-04 09:00', '2030-01-04 10:00');
select gast_etage_speichern((select id from s where name = 'b'), '{"id":"gast-alt","raeume":[{"name":"Gastraum B"}]}');
reset role;
alter table buchungen disable trigger buchungen_pruefen;
update buchungen set erstellt = now() - interval '5 minutes' where test;
alter table buchungen enable trigger buchungen_pruefen;
update gast_etagen set aktualisiert = now() - interval '20 minutes';
set role anon;
do $$ declare vorher int; begin
  select count(*) into vorher from buchungen where not test;
  perform test_buchungen_aufraeumen();
  if exists (select 1 from buchungen where test) then raise exception 'TEST FEHLGESCHLAGEN: Test-Buchungen nicht gelöscht'; end if;
  if (select count(*) from gast_etagen_laden((select id from s where name = 'b'))) <> 0 then raise exception 'TEST FEHLGESCHLAGEN: alte Gast-Etage nicht gelöscht'; end if;
  if (select count(*) from buchungen where not test) <> vorher then raise exception 'TEST FEHLGESCHLAGEN: echte Buchungen gelöscht'; end if;
end $$;

-- 9. Profil: Name und Bild ändern (nur mit eigenem Passwort), Name nur für sich selbst sichtbar
do $$ begin
  if not nutzer_passwort_aendern('David Mayer', '123', 'DavidPW99') then raise exception 'TEST FEHLGESCHLAGEN: Passwortwechsel David'; end if;
end $$;
select pg_temp.muss_scheitern($$select * from profil_speichern('David Mayer', 'falsch', 'Dave', false, null)$$, 'Passwort falsch');
select pg_temp.muss_scheitern($$select * from profil_speichern('David Mayer', 'DavidPW99', 'Marie', false, null)$$, 'schon vergeben');
select pg_temp.muss_scheitern($$select * from profil_speichern('David Mayer', 'DavidPW99', 'gast', false, null)$$, 'schon vergeben');
select pg_temp.muss_scheitern($$select * from profil_speichern('David Mayer', 'DavidPW99', '<b>x</b>', false, null)$$, '2–40 Zeichen');
select pg_temp.muss_scheitern($$select * from profil_speichern('David Mayer', 'DavidPW99', null, true, 'javascript:alert(1)')$$, 'nutzer_bild_pruefen');
do $$ declare r record; begin
  insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 9', '2.401', 2, 'David Mayer', '2030-02-01 09:00', '2030-02-01 10:00');
  select * into r from profil_speichern('David Mayer', 'DavidPW99', 'David M.', true, 'data:image/jpeg;base64,AAAA');
  if r.name <> 'David M.' or r.bild <> 'data:image/jpeg;base64,AAAA' then raise exception 'TEST FEHLGESCHLAGEN: Profil %', r; end if;
  select * into r from nutzer_login('david m.', 'DavidPW99');
  if r.bild is null or r.name <> 'David M.' then raise exception 'TEST FEHLGESCHLAGEN: Login nach Umbenennen %', r; end if;
  -- Bild entfernen, Name bleibt
  select * into r from profil_speichern('David M.', 'DavidPW99', null, true, null);
  if r.bild is not null or r.name <> 'David M.' then raise exception 'TEST FEHLGESCHLAGEN: Bild entfernen %', r; end if;
end $$;
reset role;
do $$ begin
  if (select name from buchungen where raum = 'ShareDesk 9' and start = '2030-02-01 09:00') <> 'David M.' then
    raise exception 'TEST FEHLGESCHLAGEN: Namenskopie in buchungen nicht nachgezogen';
  end if;
end $$;
set role anon;
do $$ begin
  -- Profilbilder (und Namen) anderer sind über den anon key nicht lesbar: RLS liefert 0 Zeilen
  if exists (select 1 from nutzer where bild is not null or true) then raise exception 'TEST FEHLGESCHLAGEN: nutzer lesbar'; end if;
end $$;

-- 10. Etagen: angemeldete Nutzer dürfen anlegen; ändern/löschen nur Ersteller oder Admin
do $$ begin
  if etage_speichern('David M.', 'DavidPW99', '{"id":"davids-etage","raeume":[{"name":"Davids Raum"}]}') <> 'davids-etage'
  then raise exception 'TEST FEHLGESCHLAGEN: Nutzer kann keine Etage anlegen'; end if;
  perform etage_speichern('David M.', 'DavidPW99', '{"id":"davids-etage","name":"Neu","raeume":[{"name":"Davids Raum"}]}');
  if not nutzer_passwort_aendern('Dion Himaj', '123', 'DionPW99') then raise exception 'TEST FEHLGESCHLAGEN: Passwortwechsel Dion'; end if;
end $$;
select pg_temp.muss_scheitern($$select etage_speichern('Dion Himaj', 'DionPW99', '{"id":"davids-etage","raeume":[{"name":"Dions Raum"}]}')$$, 'jemand anderes');
select pg_temp.muss_scheitern($$select etage_loeschen('Dion Himaj', 'DionPW99', 'davids-etage')$$, 'Nur der Ersteller');
do $$ begin
  -- der Admin darf fremde Etagen ändern und löschen
  perform etage_speichern('Admin_Universal', 'NeuesAdminPW1', '{"id":"davids-etage","name":"Vom Admin","raeume":[{"name":"Davids Raum"}]}');
  if (select definition->>'name' from etagen where id = 'davids-etage') <> 'Vom Admin' then raise exception 'TEST FEHLGESCHLAGEN: Admin-Änderung'; end if;
  if (select erstellt_von from etagen where id = 'davids-etage') <> 2 then raise exception 'TEST FEHLGESCHLAGEN: Ersteller überschrieben'; end if;
  perform etage_loeschen('David M.', 'DavidPW99', 'davids-etage');
  if exists (select 1 from etagen where id = 'davids-etage') then raise exception 'TEST FEHLGESCHLAGEN: Ersteller kann nicht löschen'; end if;
end $$;

reset role;
delete from buchungen where start like '2030-%';
\echo '✓ Alle SQL-Tests bestanden'
