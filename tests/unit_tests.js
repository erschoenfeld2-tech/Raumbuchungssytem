// ══════════════════════════════════════════════════════════
// Unit-Tests ohne Browser und ohne Datenbank:  node tests/unit_tests.js
//
// Prüft u.a. alle in index.html eingebundenen Etagen-Dateien (gültig,
// Raumnamen eindeutig, Tischcodes unverändert gegenüber dem alten
// Grundriss) sowie die Belegungs-/Kapazitätslogik. Keine Abhängigkeiten
// außer Node.js – läuft auch in der CI (.github/workflows/quality.yml).
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
const lies = d => fs.readFileSync(path.join(WURZEL, d), 'utf8');

// Minimaler Browser-Ersatz, damit die Skripte ohne DOM geladen werden können
const kontext = vm.createContext({
  console: { log: console.log, warn: () => {}, error: console.error },
  document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
  window: {}, Math, JSON, Date, Number, String, Array, Object, Set, Map, RegExp, Error, parseInt, isFinite,
});
const lade = datei => vm.runInContext(lies(datei), kontext, { filename: datei });
// Ergebnisse per JSON in "normale" Objekte dieses Kontexts umwandeln (für deepStrictEqual)
const js = code => {
  const v = vm.runInContext(code, kontext);
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
};

['js/config.js', 'js/ui.js', 'js/gebaeude.js', 'js/belegung.js', 'js/grundriss.js', 'js/kalender.js'].forEach(lade);
// Editor nur für jsObjektZuJson laden (der Rest braucht einen Browser)
lade('js/editor.js');

// Etagen-Dateien genau so laden, wie index.html sie einbindet
const html = lies('index.html');
const etagenDateien = [...html.matchAll(/<script src="(etagen\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);

let ok = 0, fehler = 0;
function test(name, fn){
  try { fn(); ok++; console.log('  ✓ ' + name); }
  catch(e){ fehler++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('Etagen-Dateien');
test('index.html bindet mindestens eine Etage ein', () => assert(etagenDateien.length >= 1));
test('Vorlage ist NICHT eingebunden', () => assert(!etagenDateien.some(d => d.includes('_vorlage'))));
etagenDateien.forEach(lade);
test('alle Etagen-Dateien sind gültig (keine Warnungen)', () => {
  const { warnungen } = js('etagenAufbauen([])');
  assert.deepStrictEqual(warnungen, []);
  assert.strictEqual(js('ETAGEN.length'), etagenDateien.length);
});
test('Raumnamen systemweit eindeutig', () => {
  const namen = js('ROOMS.map(r => r.name)');
  assert.strictEqual(new Set(namen).size, namen.length);
});
test('Tischcodes systemweit eindeutig je Raum', () => {
  js('ROOMS').forEach(r => assert.strictEqual(new Set(r.tische.map(t => t.code)).size, r.tische.length, r.name));
});
test('Hauptgebäude: 12 Räume wie bisher, Kapazitäten 1/2', () => {
  const rooms = js('ROOMS.filter(r => r.etageId.startsWith("hauptgebaeude"))');
  assert.strictEqual(rooms.length, 12);
  rooms.forEach(r => assert.strictEqual(r.kapazitaet, r.typ === 'meeting' ? 1 : 2, r.name));
});
test('Tischcodes identisch mit dem alten Grundriss (gespeicherte Buchungen bleiben gültig)', () => {
  // Alte Regel aus index.html (vor der Aufteilung): Raum-Nr = Position in ROOM_DEFS je Etage
  const alt = [['Besprechungsraum',1,1],['Konferenzraum',1,1],['ShareDesk 1',1,2],['ShareDesk 2',1,2],['ShareDesk 3',1,2],
    ['ShareDesk 4',1,2],['ShareDesk 5',1,2],['ShareDesk 6',2,2],['ShareDesk 7',2,2],['ShareDesk 8',2,2],['ShareDesk 9',2,2],['ShareDesk 10',2,2]];
  const zaehler = {};
  alt.forEach(([name, etage, tische]) => {
    zaehler[etage] = (zaehler[etage] || 0) + 1;
    const erwartet = Array.from({ length: tische }, (_, i) => `${etage}.${zaehler[etage]}${String(i + 1).padStart(2, '0')}`);
    assert.deepStrictEqual(js(`raumByName(${JSON.stringify(name)}).tische.map(t => t.code)`), erwartet, name);
  });
});
test('NFC-Räume = Räume aus nfc_bridge_config.py', () => {
  const cfg = lies('nfc_bridge_config.py');
  const bridge = [...cfg.matchAll(/"ACS[^"]*":\s*"([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(js('nfcRaumNamen()').sort(), bridge);
});
test('Vorlage und Etagen-Dateien lassen sich im Editor importieren (ohne Ausführen)', () => {
  ['etagen/_vorlage-etage.js', ...etagenDateien].forEach(d => {
    const def = js(`jsObjektZuJson(${JSON.stringify(lies(d))})`);
    const { fehler } = js(`normalisiereEtage(${JSON.stringify(def)}, 'test')`);
    assert.deepStrictEqual(fehler, [], d);
  });
});
test('Import lehnt Programmcode ab', () => {
  assert.throws(() => js(`jsObjektZuJson("registriereEtage({ id: alert(1) })")`), /Unerwartetes Wort/);
});
test('Grundriss rendert jede Etage ohne Fehler', () => {
  js('ETAGEN').forEach(e => {
    const svg = js(`grundrissSvg(etageById(${JSON.stringify(e.id)}), { selRaum:null, selTisch:null, raumStatus:()=>'free', tischStatus:()=>'frei' })`);
    assert(svg.includes('data-raum'), e.id);
  });
});

test('Beschriftungen liegen über Türen (Ebenen-Reihenfolge)', () => {
  js('ETAGEN').forEach(e => {
    const svg = js(`grundrissSvg(etageById(${JSON.stringify(e.id)}), { raumStatus:()=>'free', tischStatus:()=>'frei' })`);
    const letzteTuer = svg.lastIndexOf('plan-door');
    const ersteSchrift = Math.min(...['plan-label', 'plan-sub', 'desk-code', 'plan-text', 'plan-flur-label'].map(k => svg.indexOf('class="' + k)).filter(i => i >= 0));
    assert(letzteTuer < 0 || ersteSchrift > letzteTuer, e.id);
  });
});
test('Türen der Datei-Etagen schlagen in den Flur auf', () => {
  js('ETAGEN').filter(e => e.flure.length).forEach(e => e.tueren.filter(t => t.o === 'h').forEach(t => {
    const ende = t.y + t.s * t.len;
    assert(e.flure.some(f => ende >= f.y && ende <= f.y + f.h), `${e.id}: Tür bei x=${t.x} schlägt nicht in den Flur`);
  }));
});

console.log('Datenschutz');
test('Kalender und Agenda zeigen keine Namen, nur „Du“ / „belegt“', () => {
  const bs = [{ id: 1, raum: 'ShareDesk 1', tisch: '1.301', nutzer_id: 2, name: 'Geheimer Name', start: '2030-01-01 09:00', ende: '2030-01-01 11:00', quelle: 'web' },
              { id: 2, raum: 'ShareDesk 1', tisch: '1.302', nutzer_id: 1, name: 'Mein Name', start: '2030-01-01 09:00', ende: '2030-01-01 10:00', quelle: 'web' }];
  const html = js(`kalenderHtml(ROOMS.filter(r => r.name === 'ShareDesk 1'), ${JSON.stringify(bs)}, '2030-01-01', b => b.nutzer_id === 1, false)`)
    + js(`agendaHtml(${JSON.stringify(bs)}, b => b.nutzer_id === 1)`);
  assert(!html.includes('Geheimer Name') && !html.includes('Mein Name'), 'Name im HTML');
  assert(html.includes('Du') && html.includes('belegt'));
});

console.log('Etagen-Prüfung');
const pruefe = def => js(`normalisiereEtage(${JSON.stringify(def)}, 'test')`);
test('ungültige id wird abgelehnt', () => assert(pruefe({ id: 'Böse ID', raeume: [{ name: 'A' }] }).fehler.length));
test('doppelter Raumname in einer Etage wird abgelehnt', () => assert(pruefe({ id: 'x', raeume: [{ name: 'A' }, { name: 'A', nr: 2 }] }).fehler.length));
test('doppelte Raum-Nr wird abgelehnt', () => assert(pruefe({ id: 'x', raeume: [{ name: 'A', nr: 1 }, { name: 'B', nr: 1 }] }).fehler.length));
test('fremde Bild-URLs werden abgelehnt', () => {
  assert(pruefe({ id: 'x', hintergrund: 'javascript:alert(1)', raeume: [{ name: 'A' }] }).fehler.length);
  assert(pruefe({ id: 'x', hintergrund: 'https://evil.example/x.png', raeume: [{ name: 'A' }] }).fehler.length);
  assert(!pruefe({ id: 'x', hintergrund: 'etagen/bilder/a.png', raeume: [{ name: 'A' }] }).fehler.length);
});
test('Koordinaten werden auf die Fläche begrenzt', () => {
  const r = pruefe({ id: 'x', breite: 500, hoehe: 300, raeume: [{ name: 'A', x: 450, y: -5, w: 999, h: 999 }] }).etage.raeume[0];
  assert.deepStrictEqual([r.x, r.y, r.w, r.h], [450, 0, 50, 300]);
});
test('Datenbank-Etage ersetzt Datei-Etage mit gleicher id, doppelte Namen fliegen raus', () => {
  const { warnungen } = js(`etagenAufbauen([
    { id: 'hauptgebaeude-2', gebaeude: 'Hauptgebäude', nr: 2, raeume: [{ name: 'ShareDesk 6', tische: 4 }] },
    { id: 'anbau-1', gebaeude: 'Anbau', nr: 1, raeume: [{ name: 'ShareDesk 1' }] },
  ])`);
  assert.strictEqual(js('raumByName("ShareDesk 6").kapazitaet'), 4);
  assert.strictEqual(js('raumByName("ShareDesk 7")'), null);
  assert.strictEqual(js('etageById("anbau-1")'), null);
  assert.strictEqual(warnungen.length, 1);
  js('etagenAufbauen([])');
});
test('Grundriss entschärft HTML in Namen', () => {
  const e = pruefe({ id: 'x', raeume: [{ name: '<img src=x onerror=alert(1)>', typ: 'meeting' }] }).etage;
  const svg = js(`grundrissSvg(${JSON.stringify(e)}, { raumStatus:()=>'free', tischStatus:()=>'frei' })`);
  assert(!svg.includes('<img') && svg.includes('&lt;img'));
});

console.log('Belegung / Kapazität');
const B = (raum, tisch, s, e) => ({ raum, tisch, start: '2030-01-01 ' + s, ende: '2030-01-01 ' + e });
const raum2 = { name: 'R', kapazitaet: 2 };
const pruefeKap = (bs, s, e, tisch) => js(`kapazitaetPruefen(${JSON.stringify(raum2)}, ${JSON.stringify(bs)}, '2030-01-01 ${s}', '2030-01-01 ${e}', ${JSON.stringify(tisch || null)})`);
test('nacheinander liegende Buchungen blockieren nicht (alter Fehler: zählte alle Überlappungen)', () => {
  assert.strictEqual(pruefeKap([B('R','A','09:00','10:00'), B('R','B','11:00','12:00')], '09:00', '12:00', null).ok, true);
});
test('volle Belegung wird erkannt', () => {
  assert.strictEqual(pruefeKap([B('R','A','09:00','12:00'), B('R',null,'10:00','11:00')], '10:30', '11:30', 'C').ok, false);
});
test('gleicher Tisch überlappend wird abgelehnt, angrenzend erlaubt', () => {
  assert.strictEqual(pruefeKap([B('R','A','09:00','10:00')], '09:30', '10:30', 'A').ok, false);
  assert.strictEqual(pruefeKap([B('R','A','09:00','10:00')], '10:00', '11:00', 'A').ok, true);
});
test('andere Räume zählen nicht', () => {
  assert.strictEqual(pruefeKap([B('X','A','09:00','10:00'), B('X','B','09:00','10:00')], '09:00', '10:00', 'A').ok, true);
});
test('maxGleichzeitig', () => {
  assert.strictEqual(js(`maxGleichzeitig(${JSON.stringify([B('R','A','09:00','10:00'), B('R','B','09:30','11:00'), B('R','C','10:00','11:00')])}, '2030-01-01 09:00', '2030-01-01 11:00')`), 2);
});
test('Belegungsblöcke: lange Buchung = ein Block, Farbe wechselt 1/2 → 2/2', () => {
  const bl = js(`belegungsBloecke({ name:'R', kapazitaet:2 }, ${JSON.stringify([B('R','A','09:00','12:00'), B('R','B','10:00','11:00')])}, 420, 1200)`);
  assert.strictEqual(bl.length, 1);
  assert.deepStrictEqual(bl[0].segmente.map(s => s.anzahl), [1, 2, 1]);
});

console.log('Hilfsfunktionen');
test('ds() nutzt lokale Zeit (kein UTC-Versatz kurz nach Mitternacht)', () => {
  assert.strictEqual(js('ds(new Date(2026, 10, 24, 0, 30))'), '2026-11-24');
  assert.strictEqual(js('zeitStempel(new Date(2026, 0, 5, 7, 3))'), '2026-01-05 07:03');
});
test('parseZeit', () => {
  const p = t => js(`parseZeit(${JSON.stringify(t)})`);
  assert.strictEqual(p('9'), '09:00'); assert.strictEqual(p('930'), '09:30'); assert.strictEqual(p('9.15'), '09:15');
  assert.strictEqual(p('9:'), '09:00'); assert.strictEqual(p('25:00'), null); assert.strictEqual(p('abc'), null);
});
test('esc()', () => assert.strictEqual(js(`esc('<a href="x">O\\'Brien & Co</a>')`), '&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Co&lt;/a&gt;'));

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler ? 1 : 0);
