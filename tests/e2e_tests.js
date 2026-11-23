// ══════════════════════════════════════════════════════════
// Browser-Tests (End-to-End) der Live-App:  bash tests/run_tests.sh
//
// Öffnet index.html in Chromium (Playwright) und klickt die wichtigsten
// Abläufe durch: Login + Passwortwechsel, Buchen, Doppelbuchung,
// Kapazität, Grundriss, Etagenwechsel, Löschen, Gast-/Testsystem,
// Admin-Login und Etagen-Editor (Bild- und Datei-Import, Export, Löschen).
// Alle Supabase-Aufrufe werden auf die LOKALE Test-Datenbank umgeleitet
// (tests/mini_postgrest.js) – die echte Datenbank wird nie berührt.
// Screenshots landen in tests/screenshots/ (nicht im Git).
// ══════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { antwort, psql } = require('./mini_postgrest');

const WURZEL = path.join(__dirname, '..');
const BILDER = process.env.SCREENSHOT_DIR || path.join(__dirname, 'screenshots');
fs.mkdirSync(BILDER, { recursive: true });

// ── statischer Webserver für das Repo (wie GitHub Pages) ──
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.png':'image/png' };
function webserver(){
  return new Promise(ok => {
    const srv = http.createServer((req, res) => {
      const datei = path.join(WURZEL, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if(!datei.startsWith(WURZEL) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()){
        const index = path.join(datei, 'index.html');
        if(fs.existsSync(index)){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(index)); }
        res.writeHead(404); return res.end('404');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(datei)] || 'application/octet-stream' });
      res.end(fs.readFileSync(datei));
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}

let ok = 0, fehler = 0;
const fehlerListe = [];
async function test(name, fn){
  try { await fn(); ok++; console.log('  ✓ ' + name); }
  catch(e){ fehler++; fehlerListe.push(name); console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n').filter(Boolean).slice(0, 3).join('\n      ')); }
}
function erwarte(bedingung, text){ if(!bedingung) throw new Error(text); }
const sql = s => { const r = psql(s, false); if(r.fehler) throw new Error(r.fehler); return r.text; };
const morgen = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); })();

async function main(){
  const srv = await webserver();
  const BASIS = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Europe/Berlin', locale: 'de-DE', acceptDownloads: true });
  let supabaseAnfragen = 0;
  await ctx.route(/yugjccgblqsfjasienwa\.supabase\.co/, async route => {
    const req = route.request();
    supabaseAnfragen++;
    const r = antwort(req.method(), req.url(), req.headers(), req.postData());
    await route.fulfill({ status: r.status, body: r.body, headers: {
      'content-type': 'application/json', 'access-control-allow-origin': '*',
      'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
  });
  // Die Website darf außer sich selbst und (umgeleitet) Supabase nichts nachladen
  const fremd = [];
  await ctx.route(url => !url.href.startsWith(BASIS) && !url.href.includes('supabase.co'), r => { fremd.push(r.request().url()); r.abort(); });

  const page = await ctx.newPage();
  const jsFehler = [], dialoge = [];
  page.on('pageerror', e => jsFehler.push(e.message));
  // 400er sind gewollte Ablehnungen der Datenbank (z.B. Gast-Limit) – keine Programmfehler
  page.on('console', m => { if(m.type() === 'error' && !/status of 400/.test(m.text())) jsFehler.push(m.text()); });
  page.on('dialog', d => { if(d.type() === 'confirm') d.accept(); else { dialoge.push(d.message()); d.dismiss(); } });

  const toastText = async (enthaelt) => {
    await page.waitForFunction(t => { const el = document.getElementById('toast'); return el.className.includes('show') && el.textContent.includes(t); }, enthaelt, { timeout: 5000 });
    return page.textContent('#toast');
  };
  // eigenes Dropdown bedienen: öffnen und den Eintrag mit diesem Wert anklicken
  const waehle = async (selectId, wert) => {
    await page.click(`.cs:has(#${selectId}) .cs-btn`);
    await page.click(`.cs.cs-open .cs-opt[data-v="${wert}"]`);
  };
  const zeit = async (id, wert) => { await page.fill('#' + id, wert); await page.keyboard.press('Enter'); };
  const buche = async (raum, tisch, von, bis) => {
    await page.fill('#f-datum', morgen); await page.dispatchEvent('#f-datum', 'change');
    await waehle('f-raum', raum);
    if(tisch) await waehle('f-tisch', tisch);
    await zeit('f-start', von); await zeit('f-ende', bis);
    await page.click('#btn-buchen');
  };
  const editorZu = async () => {
    await page.keyboard.press('Escape');
    if(await page.isVisible('#frage-modal.open')) await page.click('#frage-ok');
    await page.waitForSelector('#editor-bg.open', { state: 'hidden' });
  };
  const anmelden = async (name, pw) => {
    await page.fill('#login-name', name); await page.fill('#login-pw', pw); await page.click('#login-btn');
  };

  console.log('Login');
  await test('Startseite lädt ohne JavaScript-Fehler und ohne fremde Server', async () => {
    await page.goto(BASIS);
    await page.waitForSelector('#login-screen');
    erwarte(await page.title() === 'Raumbuchungssystem', 'Titel falsch');
    erwarte(!jsFehler.length, 'JS-Fehler: ' + jsFehler.join(' | '));
    erwarte(!fremd.length, 'lädt fremde URLs: ' + fremd.join(', '));
    await page.screenshot({ path: path.join(BILDER, '01-login.png') });
  });
  await test('falsches Passwort wird abgelehnt', async () => {
    await anmelden('Marie', 'falsch');
    await page.waitForSelector('#login-err.show');
    erwarte((await page.textContent('#login-err')).includes('falsch'), 'keine Fehlermeldung');
  });
  await test('Erst-Login erzwingt Passwortwechsel, danach App sichtbar', async () => {
    await anmelden('Marie', '123');
    await page.waitForSelector('#pw-neu', { state: 'visible' });
    await page.fill('#pw-neu', 'geheim123'); await page.fill('#pw-neu2', 'geheim123');
    await page.click('#login-btn');
    await page.waitForSelector('#app', { state: 'visible' });
    await page.waitForSelector('.cal-header');
    erwarte((await page.textContent('#user-name')).trim() === 'Marie', 'Nutzername fehlt');
  });
  await test('Admin-Passwort steht nicht mehr im Frontend', async () => {
    for(const d of fs.readdirSync(path.join(WURZEL, 'js'))) erwarte(!fs.readFileSync(path.join(WURZEL, 'js', d), 'utf8').includes('System-2026!'), d);
    erwarte(!fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8').includes('System-2026!'), 'index.html');
  });

  console.log('Buchen');
  await test('Etagen-Tabs kommen aus den Etagen-Dateien, Kalender zeigt 7 Räume', async () => {
    const tabs = await page.$$eval('#etage-tabs button', bs => bs.map(b => b.textContent));
    erwarte(JSON.stringify(tabs) === '["Etage 1","Etage 2"]', 'Tabs: ' + tabs);
    erwarte(!(await page.isVisible('#gebaeude-tabs')), 'Gebäude-Tabs bei nur einem Gebäude sichtbar');
    erwarte(await page.$$eval('.cal-header > div', d => d.length) === 8, 'Spaltenzahl falsch');
    erwarte(await page.isVisible('#btn-etage-neu'), 'Etagen-Editor für Nutzer nicht sichtbar');
    erwarte(!(await page.isVisible('#btn-testsystem')), 'Admin-Knopf „Testsystem“ für Nicht-Admin sichtbar');
  });
  await test('Buchung über das Formular (eigene Dropdowns, Zeitfelder)', async () => {
    await buche('ShareDesk 1', '1.302', '09:00', '10:30');
    await toastText('Buchung erstellt');
    erwarte(sql(`select count(*) from buchungen where raum='ShareDesk 1' and tisch='1.302' and start='${morgen} 09:00' and ende='${morgen} 10:30' and not test`) === '1', 'nicht in DB');
    await page.waitForSelector('.cal-seg.mine');
    await page.screenshot({ path: path.join(BILDER, '02-kalender.png') });
  });
  await test('Dropdowns: Gruppen, Status-Punkte, Häkchen am gewählten Eintrag, Tastatur', async () => {
    await page.click('.cs:has(#f-raum) .cs-btn');
    const gruppen = await page.$$eval('.cs.cs-open .cs-gruppe', g => g.map(x => x.textContent));
    erwarte(JSON.stringify(gruppen) === '["Meetingräume","ShareDesks"]', 'Gruppen: ' + gruppen);
    erwarte(await page.$$eval('.cs.cs-open .cs-list .cs-punkt', p => p.length) === 7, 'Status-Punkte fehlen');
    erwarte((await page.textContent('.cs.cs-open .cs-opt.selected .cs-haken')).includes('✓'), 'kein Häkchen');
    erwarte(await page.isVisible('.cs.cs-open .cs-opt[data-v="ShareDesk 1"] .cs-hinweis'), 'Hinweis fehlt');
    await page.keyboard.press('Escape');
    erwarte(!(await page.$('.cs.cs-open')), 'Escape schließt nicht');
    // Tastatur: Pfeil runter öffnet, Enter wählt
    await page.focus('.cs:has(#f-raum) .cs-btn');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    erwarte(!(await page.$('.cs.cs-open')), 'Enter schließt nicht');
    await page.screenshot({ path: path.join(BILDER, '02b-dropdown.png') });
  });
  await test('Häkchen sind Schalter (Ganztägig)', async () => {
    await waehle('f-raum', 'ShareDesk 1');
    const stil = await page.$eval('#f-ganztag', el => getComputedStyle(el).appearance);
    erwarte(stil === 'none', 'Checkbox nicht als Schalter gestaltet: ' + stil);
    await page.check('#f-ganztag');
    erwarte(await page.isDisabled('#f-start'), 'Ganztägig sperrt die Zeitfelder nicht');
    await page.uncheck('#f-ganztag');
  });
  await test('gleicher Tisch überlappend → abgelehnt', async () => {
    await buche('ShareDesk 1', '1.302', '10:00', '11:00');
    await toastText('bereits belegt');
  });
  await test('Kapazität: NFC-Buchung (ohne Tisch) + Web-Buchung = Raum voll', async () => {
    sql(`insert into buchungen (raum, nutzer_id, name, start, ende, quelle) values ('ShareDesk 2', 2, 'David Mayer', '${morgen} 09:00', '${morgen} 10:00', 'nfc')`);
    await buche('ShareDesk 2', '1.401', '09:00', '10:00');
    await toastText('Buchung erstellt');
    await buche('ShareDesk 2', '1.402', '09:30', '10:00');
    await toastText('ausgebucht');
  });
  await test('nacheinander liegende Buchungen blockieren den Raum nicht mehr', async () => {
    await buche('ShareDesk 2', '1.402', '08:00', '12:00');
    await toastText('ausgebucht');   // 09–10 sind schon 2/2 belegt …
    await buche('ShareDesk 2', '1.402', '10:00', '12:00');
    await toastText('Buchung erstellt');   // … ab 10 Uhr ist wieder Platz
  });
  await test('Vergangenheit kann nicht gebucht werden', async () => {
    const gestern = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    await page.evaluate(d => { document.getElementById('f-datum').value = d; }, gestern);
    await waehle('f-raum', 'ShareDesk 3');
    await zeit('f-start', '09:00'); await zeit('f-ende', '10:00');
    await page.click('#btn-buchen');
    await toastText('Vergangenheit');
  });

  console.log('Ansichten');
  await test('Grundriss zeigt gebuchten Tisch rot, Klick wählt Tisch aus', async () => {
    await page.fill('#f-datum', morgen); await page.dispatchEvent('#f-datum', 'change');
    await page.click('#view-office');
    await page.waitForSelector('#floorplan [data-tisch="1.302"] .desk-badge.belegt');
    await page.click('#floorplan .plan-desk[data-tisch="1.501"]');
    erwarte(await page.inputValue('#f-raum') === 'ShareDesk 3' && await page.inputValue('#f-tisch') === '1.501', 'Auswahl übernommen?');
    await page.screenshot({ path: path.join(BILDER, '03-grundriss-etage1.png') });
  });
  await test('Etage 2: eigene Adresse ?etage=…, bleibt nach Neuladen erhalten', async () => {
    await page.click('#etage-tabs [data-etage="hauptgebaeude-2"]');
    erwarte(page.url().includes('etage=hauptgebaeude-2'), 'URL: ' + page.url());
    await page.reload();
    await page.waitForSelector('#etage-tabs [data-etage="hauptgebaeude-2"].active');
    await page.click('#view-cal');
    erwarte(await page.$$eval('.cal-header > div', d => d.length) === 6, 'Spaltenzahl Etage 2');
    await page.click('#view-office');
    await page.screenshot({ path: path.join(BILDER, '04-grundriss-etage2.png') });
    await page.click('#etage-tabs [data-etage="hauptgebaeude-1"]');
    await page.click('#view-cal');
  });
  await test('Türbögen überdecken weder Beschriftungen noch Möbel', async () => {
    await page.click('#view-office');
    for(const id of ['hauptgebaeude-1', 'hauptgebaeude-2']){
      await page.click(`#etage-tabs [data-etage="${id}"]`);
      const treffer = await page.evaluate(() => {
        const box = el => { const b = el.getBBox(); return { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height }; };
        const schneidet = (a, b) => a.x1 < b.x2 - 0.5 && a.x2 > b.x1 + 0.5 && a.y1 < b.y2 - 0.5 && a.y2 > b.y1 + 0.5;
        const svg = document.getElementById('floorplan');
        const tueren = [...svg.querySelectorAll('.plan-door')].map(box);
        const andere = [...svg.querySelectorAll('text, .plan-desk-moebel rect, .plan-room rect:not(.plan-fill), .desk-badge')]
          .map(el => ({ el: el.textContent || el.getAttribute('class') || el.tagName, b: box(el) }));
        const funde = [];
        tueren.forEach((t, i) => andere.forEach(a => { if(schneidet(t, a.b)) funde.push(`Tür ${i} ↔ ${a.el}`); }));
        return funde;
      });
      erwarte(!treffer.length, `${id}: ${treffer.slice(0, 5).join(', ')}`);
    }
    await page.click('#etage-tabs [data-etage="hauptgebaeude-1"]');
    await page.screenshot({ path: path.join(BILDER, '03b-tueren.png') });
    await page.click('#view-cal');
  });
  await test('Agenda-Eintrag öffnet Details, eigene Buchung löschen, Escape schließt', async () => {
    await page.setViewportSize({ width: 390, height: 844 });   // Agenda ist die Mobil-Ansicht
    await page.fill('#f-datum', morgen); await page.dispatchEvent('#f-datum', 'change');
    await page.waitForSelector('#agenda-list [data-bid]');
    await page.screenshot({ path: path.join(BILDER, '05-mobil.png'), fullPage: false });
    const bid = sql(`select id from buchungen where tisch='1.302' and start='${morgen} 09:00'`);
    await page.click(`#agenda-list [data-bid="${bid}"]`);
    await page.waitForSelector('#modal.open');
    await page.keyboard.press('Escape');
    erwarte(!(await page.isVisible('#modal.open')), 'Escape schließt nicht');
    await page.click(`#agenda-list [data-bid="${bid}"]`);
    await page.click('#m-delete');
    await toastText('gelöscht');
    erwarte(sql(`select count(*) from buchungen where id=${bid}`) === '0', 'nicht gelöscht');
    await page.setViewportSize({ width: 1400, height: 900 });
  });
  await test('Datenschutz: fremde Namen erscheinen nirgends (nur „belegt“), kein XSS', async () => {
    const id = sql(`insert into nutzer (name) values ('<img src=x onerror=alert(1)> O''Brien') returning id`).split('\n').pop();
    sql(`insert into buchungen (raum, tisch, nutzer_id, name, start, ende) values ('ShareDesk 4', '1.601', ${id}, 'x', '${morgen} 13:00', '${morgen} 14:00')`);
    await page.reload();
    await page.waitForSelector('.cal-header');
    await page.fill('#f-datum', morgen); await page.dispatchEvent('#f-datum', 'change');
    await page.waitForSelector('.cal-seg[data-raum="ShareDesk 4"]');
    await page.click('.cal-seg[data-raum="ShareDesk 4"]');
    await page.waitForSelector('#slot-modal.open');
    await page.click('#slot-body [data-bid]');
    await page.waitForSelector('#modal.open');
    erwarte((await page.textContent('#m-nutzer')) === 'einer anderen Person', 'Name angezeigt: ' + await page.textContent('#m-nutzer'));
    erwarte(!(await page.isVisible('#m-delete')), 'fremde Buchung löschbar');
    const html = await page.content();
    for(const name of ["O'Brien", 'O&#39;Brien', 'David Mayer', 'Dion Himaj', 'Eric Schoenfeld', 'Luca Guinness', 'Admin_Universal'])
      erwarte(!html.includes(name), 'Name im Seiteninhalt: ' + name);
    erwarte(!dialoge.length, 'Skript wurde ausgeführt: ' + dialoge);
    await page.keyboard.press('Escape');
  });
  await test('Buchung in unbekanntem (gelöschtem) Raum bringt die Seite nicht zum Absturz', async () => {
    sql(`insert into buchungen (raum, nutzer_id, name, start, ende) values ('Abgebauter Raum', 1, 'Marie', '${morgen} 15:00', '${morgen} 16:00')`);
    await page.reload(); await page.waitForSelector('.cal-header');
    erwarte(!jsFehler.length, 'JS-Fehler: ' + jsFehler.join(' | '));
  });
  await test('Angemeldeter Nutzer legt eine Etage an – dauerhaft und für alle sichtbar', async () => {
    erwarte(await page.isVisible('#btn-etage-neu'), 'Editor-Knopf für Nutzer fehlt');
    erwarte(!(await page.isVisible('#btn-etage-bearbeiten')), 'Datei-Etage für Nutzer bearbeitbar');
    erwarte(!(await page.isVisible('#btn-testsystem')), 'Testsystem-Knopf für Nutzer sichtbar');
    await page.click('#btn-etage-neu');
    await page.waitForSelector('#editor-bg.open');
    // nach dem Neuladen ist das Passwort nicht mehr im Speicher → verdeckt nachfragen
    if(await page.isVisible('#ed-pw')){
      erwarte(await page.inputValue('#ed-pw') === '', 'Passwortfeld vorausgefüllt');
      await page.fill('#ed-pw', 'geheim123');
    }
    await page.fill('#ed-gebaeude', 'Maries Haus'); await page.fill('#ed-nr', '1');
    await page.dispatchEvent('#ed-nr', 'input');
    const box = await page.locator('#ed-svg').boundingBox();
    const f = box.width / 960;
    await page.mouse.move(box.x + 40*f, box.y + 40*f); await page.mouse.down();
    await page.mouse.move(box.x + 400*f, box.y + 220*f, { steps: 6 }); await page.mouse.up();
    await page.fill('#ed-el-name', 'Maries Raum');
    await page.click('#ed-speichern');
    await toastText('Etage gespeichert');
    erwarte(sql(`select e.erstellt_von = n.id from etagen e, nutzer n where e.id = 'maries-haus-1' and n.name = 'Marie'`) === 't', 'Ersteller fehlt');
    erwarte(await page.isVisible('#btn-etage-bearbeiten'), 'eigene Etage nicht bearbeitbar');
    await page.evaluate(() => switchEtage('hauptgebaeude-1'));
  });
  await test('Profil: Bild, Name, Passwort und „Meine Buchungen“', async () => {
    await page.click('#btn-profil');
    await page.waitForSelector('#profil-modal.open');
    await page.waitForSelector('#pr-buchungen .profil-buchung');
    erwarte((await page.textContent('#pr-zusammenfassung')).match(/\d+ Buchung/), 'Zusammenfassung fehlt');
    await page.screenshot({ path: path.join(BILDER, '12-profil.png') });
    // Bild + Name (Passwort aus der Anmeldung im Speicher → keine Rückfrage)
    await page.setInputFiles('#pr-bild-datei', path.join(__dirname, 'fixtures', 'profilbild.png'));
    await page.waitForSelector('#pr-bild img');
    await page.fill('#pr-name', 'Marie K.');
    await page.click('#pr-speichern');
    await page.waitForSelector('#pr-meldung.ok');
    erwarte(sql(`select count(*) from nutzer where name = 'Marie K.' and bild like 'data:image/jpeg;base64,%'`) === '1', 'Profil nicht gespeichert');
    erwarte(await page.isVisible('#avatar img'), 'Avatar zeigt kein Bild');
    erwarte((await page.textContent('#user-name')).trim() === 'Marie K.', 'Name im Kopf nicht aktualisiert');
    // Passwort ändern: aktuelles Passwort wird verdeckt abgefragt
    await page.fill('#pr-pw-neu', 'neuesPW456'); await page.fill('#pr-pw-neu2', 'neuesPW456');
    await page.click('#pr-speichern');
    await page.waitForSelector('#frage-modal.open');
    erwarte(await page.getAttribute('#frage-pw', 'type') === 'password', 'Passwortfeld nicht verdeckt');
    await page.fill('#frage-pw', 'geheim123');
    await page.click('#frage-ok');
    await page.waitForSelector('#pr-meldung.ok');
    erwarte(sql(`select count(*) from nutzer where name = 'Marie K.' and passwort_hash = extensions.crypt('neuesPW456', passwort_hash)`) === '1', 'Passwort nicht geändert');
    // Buchung aus dem Profil löschen
    const vorher = await page.$$eval('#pr-buchungen .profil-buchung', b => b.length);
    await page.click('#pr-buchungen [data-loeschen] >> nth=0');
    await page.click('#frage-ok');
    await toastText('gelöscht');
    await page.waitForFunction(n => document.querySelectorAll('#pr-buchungen .profil-buchung').length === n - 1, vorher);
    // Zum Tag springen schließt das Profil und zeigt den Tag
    await page.click('#pr-buchungen [data-tag] >> nth=0');
    await page.waitForSelector('#profil-modal.open', { state: 'hidden' });
  });
  await test('Abmelden stoppt die Aktualisierung', async () => {
    await page.click('#btn-abmelden');
    await page.waitForSelector('#login-screen', { state: 'visible' });
    const vorher = supabaseAnfragen;
    await page.waitForTimeout(6500);
    erwarte(supabaseAnfragen === vorher, `${supabaseAnfragen - vorher} Anfragen nach dem Abmelden`);
  });

  console.log('Gast / Testsystem');
  await test('Direktlink ?gast öffnet das Testsystem', async () => {
    await page.goto(BASIS + '?gast');
    await page.waitForSelector('#gast-banner', { state: 'visible' });
    erwarte(!page.url().includes('gast'), 'gast-Parameter bleibt in der URL');
  });
  await test('Gast sieht keine echten Buchungen, NFC-Räume gesperrt, Buchung landet als test', async () => {
    erwarte(!(await page.$('.cal-seg.status-partial')) || true, '');
    const sichtbar = await page.$$eval('.cal-seg', s => s.length);
    await page.fill('#f-datum', morgen); await page.dispatchEvent('#f-datum', 'change');
    await page.waitForTimeout(400);
    erwarte(await page.$$eval('.cal-seg', s => s.length) === 0, 'echte Buchungen im Testsystem sichtbar (' + sichtbar + ')');
    await page.click('.cal-cell[data-raum="Besprechungsraum"] >> nth=6');
    await page.waitForSelector('#slot-modal.open');
    erwarte((await page.textContent('#slot-body')).includes('nur per NFC'), 'NFC-Sperre fehlt');
    await page.keyboard.press('Escape');
    await buche('ShareDesk 3', '1.502', '11:00', '12:00');
    await toastText('Buchung erstellt');
    erwarte(sql(`select count(*) from buchungen where tisch='1.502' and test and gast_sitzung is not null`) === '1', 'nicht als Test-Buchung der Sitzung gespeichert');
    erwarte((await page.textContent('#gast-limit')).includes('Noch 9 von 10'), 'Limit-Anzeige: ' + await page.textContent('#gast-limit'));
    await page.waitForSelector('.cal-seg.mine');
    await page.screenshot({ path: path.join(BILDER, '06-gast.png') });
  });
  // zweiter Gast in einem eigenen Browser-Fenster (eigene Sitzung)
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Europe/Berlin', locale: 'de-DE' });
  await ctx2.route(/yugjccgblqsfjasienwa\.supabase\.co/, async route => {
    const req = route.request();
    const r = antwort(req.method(), req.url(), req.headers(), req.postData());
    await route.fulfill({ status: r.status, body: r.body, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  });
  const gast2 = await ctx2.newPage();
  const gast2Bucht = async (raum, nr) => {
    await gast2.evaluate(() => { document.getElementById('toast').textContent = ''; });
    await gast2.click(`.cal-cell[data-raum="${raum}"] >> nth=${nr}`);
    await gast2.click('#slot-buchen');
    await gast2.waitForFunction(() => { const t = document.getElementById('toast'); return t.className.includes('show') && t.textContent.includes('Buchung erstellt'); });
  };
  gast2.on('pageerror', e => jsFehler.push('Gast 2: ' + e.message));
  await test('Gast legt eigene Etage per Datei an – nur in seiner Sitzung sichtbar', async () => {
    await page.click('#btn-etage-neu');
    await page.waitForSelector('#editor-bg.open');
    erwarte(!(await page.isVisible('#ed-pw')), 'Passwortfeld beim Gast sichtbar');
    await page.setInputFiles('#ed-datei', path.join(__dirname, 'fixtures', 'beispiel-etage.json'));
    await page.waitForSelector('#ed-meldung.ok');
    await page.click('#ed-speichern');
    await toastText('nur für dich sichtbar');
    await page.waitForSelector('#gebaeude-tabs [data-gebaeude="Anbau"]');
    erwarte(sql(`select count(*) from etagen where id = 'anbau-eg'`) === '0', 'Gast-Etage in der öffentlichen Tabelle');
    await gast2.goto(BASIS + '?gast');
    await gast2.waitForSelector('#gast-banner', { state: 'visible' });
    await gast2.waitForSelector('.cal-header');
    erwarte(!(await gast2.$('#gebaeude-tabs [data-gebaeude="Anbau"]')), 'fremde Gast-Etage sichtbar');
  });
  await test('Gäste sehen gegenseitig nur „belegt“ und können fremde Test-Buchungen nicht löschen', async () => {
    await gast2.fill('#f-datum', morgen); await gast2.dispatchEvent('#f-datum', 'change');
    await gast2.waitForSelector('.cal-seg[data-raum="ShareDesk 3"]');
    erwarte(!(await gast2.$('.cal-seg.mine')), 'fremde Buchung als eigene markiert');
    await gast2.click('.cal-seg[data-raum="ShareDesk 3"]');
    await gast2.click('#slot-body [data-bid]');
    erwarte((await gast2.textContent('#m-nutzer')) === 'einer anderen Person', 'Anzeige');
    erwarte(!(await gast2.isVisible('#m-delete')), 'fremde Test-Buchung löschbar');
    await gast2.keyboard.press('Escape');
    // Gast 2 bucht selbst etwas (bleibt beim Zurücksetzen von Gast 1 bestehen)
    await gast2Bucht('ShareDesk 5', 10);
  });
  await test('„Meine Änderungen zurücksetzen“ löscht nur die eigenen Buchungen und Etagen', async () => {
    await page.click('#btn-zuruecksetzen');
    await page.click('#frage-ok');
    await toastText('Zurückgesetzt: 1 Buchung(en), 1 Etage(n)');
    erwarte(!(await page.$('#gebaeude-tabs [data-gebaeude="Anbau"]')), 'eigene Etage noch da');
    erwarte(sql(`select count(*) from buchungen where test`) === '1', 'Buchung von Gast 2 mit gelöscht');
  });
  await test('Limit: höchstens 10 Änderungen in 2 Minuten je Gast', async () => {
    const sitzung = await page.evaluate(() => currentUser.sitzung);
    // bisher gezählt: 1 Buchung + 1 gespeicherte Etage (Zurücksetzen zählt nicht) → 7 dazu = 9
    sql(`insert into gast_aenderungen (sitzung) select '${sitzung}' from generate_series(1, 7)`);
    await buche('ShareDesk 4', '1.601', '15:00', '16:00');
    await toastText('Buchung erstellt');
    erwarte((await page.textContent('#gast-limit')).includes('Noch 0 von 10'), await page.textContent('#gast-limit'));
    await buche('ShareDesk 4', '1.602', '15:00', '16:00');
    await toastText('höchstens 10 Änderungen');
  });

  console.log('Admin / Etagen-Editor');
  await test('Admin meldet sich über die DB an (Zwangswechsel), sieht Editor-Knöpfe', async () => {
    await page.click('#btn-abmelden');
    await anmelden('Admin_Universal', 'System-2026!');
    await page.waitForSelector('#pw-neu', { state: 'visible' });
    await page.fill('#pw-neu', 'AdminNeu2026'); await page.fill('#pw-neu2', 'AdminNeu2026');
    await page.click('#login-btn');
    await page.waitForSelector('#admin-tabs', { state: 'visible' });
  });
  await test('Neues Gebäude per Grundriss-Bild: Bild laden, Räume aufziehen, speichern', async () => {
    await page.click('#btn-etage-neu');
    await page.waitForSelector('#editor-bg.open');
    await page.setInputFiles('#ed-bild', path.join(__dirname, 'fixtures', 'grundriss-beispiel.svg'));
    await page.waitForFunction(() => document.querySelector('#ed-svg image'));
    erwarte(await page.inputValue('#ed-hoehe') === '480', 'Seitenverhältnis nicht übernommen');
    await page.fill('#ed-gebaeude', 'Werkstatt'); await page.fill('#ed-nr', '1'); await page.fill('#ed-name', 'Erdgeschoss');
    await page.dispatchEvent('#ed-nr', 'input');
    erwarte(await page.inputValue('#ed-id') === 'werkstatt-1', 'ID nicht automatisch: ' + await page.inputValue('#ed-id'));
    const ziehe = async (x1, y1, x2, y2) => {   // Koordinaten in Etagen-Pixeln (960 breit)
      const box = await page.locator('#ed-svg').boundingBox();   // jedes Mal neu (Seite kann scrollen)
      const f = box.width / 960;
      await page.mouse.move(box.x + x1*f, box.y + y1*f); await page.mouse.down();
      await page.mouse.move(box.x + x2*f, box.y + y2*f, { steps: 6 }); await page.mouse.up();
    };
    await ziehe(30, 30, 330, 195);
    await page.fill('#ed-el-name', 'Werkstatt A');
    await page.fill('#ed-el-tische', '4');
    await ziehe(340, 30, 635, 195);
    await page.fill('#ed-el-name', 'Werkstatt B');
    await waehle('ed-el-typ', 'meeting');
    await page.check('#ed-el-nfc');
    await waehle('ed-neu-art', 'bereiche');
    await ziehe(645, 30, 930, 195);
    await page.fill('#ed-el-name', 'Lager');
    const lager = JSON.parse(await page.evaluate(() => JSON.stringify(ed.def.bereiche[0])));
    erwarte(lager.x === 645 && lager.y === 30 && lager.w === 285 && lager.h === 165, 'Rechteck falsch: ' + JSON.stringify(lager));
    await page.screenshot({ path: path.join(BILDER, '07-editor.png') });
    await page.click('#ed-vorschau');
    await page.screenshot({ path: path.join(BILDER, '08-editor-vorschau.png') });
    await page.click('#ed-vorschau');
    await page.click('#ed-speichern');
    await page.waitForSelector('#editor-bg.open', { state: 'hidden' });
    await toastText('Etage gespeichert');
    const def = JSON.parse(sql(`select definition from etagen where id='werkstatt-1'`));
    erwarte(def.raeume.length === 2 && def.bereiche.length === 1 && def.hintergrund.startsWith('data:image/jpeg'), 'DB-Inhalt: ' + JSON.stringify(def).slice(0, 200));
    erwarte(await page.isVisible('#gebaeude-tabs [data-gebaeude="Werkstatt"].active'), 'Gebäude-Tab fehlt');
  });
  await test('neue Etage ist sofort buchbar (Grundriss mit Bild, 4 Tische)', async () => {
    await page.click('#view-office');
    await page.waitForSelector('#floorplan image');
    erwarte(await page.$$eval('#floorplan .plan-desk', d => d.length) === 4, 'Tische fehlen');
    await page.click('#floorplan .plan-desk[data-tisch="1.103"]');
    await zeit('f-start', '14:00'); await zeit('f-ende', '15:00');
    await page.fill('#f-datum', morgen); await page.dispatchEvent('#f-datum', 'change');
    await page.click('#floorplan .plan-desk[data-tisch="1.103"]');
    await page.click('#btn-buchen');
    await toastText('Buchung erstellt');
    await page.waitForSelector('#floorplan .plan-desk[data-tisch="1.103"] .desk-badge.belegt');
    await page.screenshot({ path: path.join(BILDER, '09-neue-etage-mit-bild.png') });
  });
  await test('Export als Etagen-Datei (.js) und Re-Import', async () => {
    await page.click('#btn-etage-bearbeiten');
    await page.waitForSelector('#editor-bg.open');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ed-export-js')]);
    erwarte(dl.suggestedFilename() === 'werkstatt-etage-1.js', 'Dateiname ' + dl.suggestedFilename());
    const ziel = path.join(BILDER, dl.suggestedFilename());
    await dl.saveAs(ziel);
    erwarte(fs.readFileSync(ziel, 'utf8').includes('registriereEtage({'), 'Inhalt');
    await page.setInputFiles('#ed-datei', ziel);
    await page.waitForSelector('#ed-meldung.ok');
    await editorZu();
  });
  await test('Neue Etage per JSON-Datei importieren (anderes Gebäude, Kürzel)', async () => {
    await page.click('#btn-etage-neu');
    await page.setInputFiles('#ed-datei', path.join(__dirname, 'fixtures', 'beispiel-etage.json'));
    await page.waitForSelector('#ed-meldung.ok');
    await page.click('#ed-speichern');
    await toastText('Etage gespeichert');
    await page.waitForSelector('#floorplan [data-tisch="A-0.206"]');
    await page.screenshot({ path: path.join(BILDER, '10-import-json.png') });
  });
  await test('Raumname, der schon existiert, wird im Editor abgelehnt', async () => {
    await page.click('#btn-etage-neu');
    await page.setInputFiles('#ed-datei', path.join(__dirname, 'fixtures', 'beispiel-etage.json'));
    await page.waitForSelector('#ed-meldung.ok');   // Datei wird asynchron gelesen – erst danach die ID ändern
    await page.fill('#ed-id', 'anbau-kopie');
    await page.dispatchEvent('#ed-id', 'input');
    await page.click('#ed-speichern');
    await page.waitForSelector('#ed-meldung.fehler');
    erwarte((await page.textContent('#ed-meldung')).includes('gibt es schon'), await page.textContent('#ed-meldung'));
    await editorZu();
  });
  await test('Datenbank-Etage löschen', async () => {
    await page.click('#gebaeude-tabs [data-gebaeude="Werkstatt"]');
    await page.click('#btn-etage-bearbeiten');
    await page.click('#ed-db-loeschen');
    await page.click('#frage-ok');
    await toastText('Etage gelöscht');
    erwarte(!(await page.$('#gebaeude-tabs [data-gebaeude="Werkstatt"]')), 'Tab noch da');
    erwarte(sql(`select count(*) from etagen where id='werkstatt-1'`) === '0', 'noch in DB');
  });
  await test('Admin schaut ins Testsystem, löscht eine Gast-Buchung und leert alles', async () => {
    erwarte(!(await page.isVisible('#ed-pw')), '');
    await page.click('#btn-testsystem');
    await page.waitForSelector('#admin-test-teil', { state: 'visible' });
    await page.evaluate(() => switchEtage('hauptgebaeude-1'));
    await page.click('#view-cal');
    await page.fill('#f-datum', morgen); await page.dispatchEvent('#f-datum', 'change');
    await page.waitForSelector('.cal-seg[data-raum="ShareDesk 5"]');
    await page.screenshot({ path: path.join(BILDER, '11-admin-testsystem.png') });
    await page.click('.cal-seg[data-raum="ShareDesk 5"]');
    await page.click('#slot-body [data-bid]');
    erwarte(await page.isVisible('#m-delete'), 'Admin darf Gast-Buchung nicht löschen');
    await page.click('#m-delete');
    await toastText('gelöscht');
    // weitere Test-Daten anlegen und alles leeren
    await gast2.fill('#f-datum', morgen); await gast2.dispatchEvent('#f-datum', 'change');
    await gast2Bucht('ShareDesk 4', 4);
    erwarte(sql(`select count(*) from buchungen where test`) !== '0', 'keine Test-Daten zum Leeren');
    const echt = sql(`select count(*) from buchungen where not test`);
    await page.click('#btn-test-leeren');
    await page.click('#frage-ok');
    await toastText('Testsystem geleert');
    erwarte(sql(`select count(*) from buchungen where test`) === '0', 'Test-Buchungen übrig');
    erwarte(sql(`select count(*) from buchungen where not test`) === echt, 'echte Buchungen gelöscht');
    await page.click('#btn-testsystem');
    await page.waitForSelector('#gast-banner', { state: 'hidden' });
  });
  await test('keine JavaScript-Fehler während des gesamten Laufs', async () => {
    erwarte(!jsFehler.length, jsFehler.join(' | '));
  });

  await browser.close();
  srv.close();
  console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen${fehler ? ': ' + fehlerListe.join('; ') : ''}`);
  console.log('Screenshots: ' + BILDER);
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
