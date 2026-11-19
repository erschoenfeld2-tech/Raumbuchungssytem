// ══════════════════════════════════════════════════════════
// Gebäude / Etagen / Räume
//
// Jede Etage ist eine eigene Definition (ein Objekt), entweder
//   • als Datei in etagen/*.js  (registriereEtage({...}), Vorlage:
//     etagen/_vorlage-etage.js), oder
//   • in der Datenbank-Tabelle "etagen" (angelegt über den Etagen-Editor
//     per Bild/JSON-Datei, Migration 20261119150100).
// Hier werden alle Definitionen geprüft, vereinheitlicht und zu den
// globalen Listen ETAGEN (alle Etagen) und ROOMS (alle buchbaren Räume)
// zusammengeführt. Eine Datenbank-Etage mit derselben id ersetzt die
// gleichnamige Datei-Etage (so kann ein Admin eine Etage im Browser anpassen).
// Im Testsystem kommen zuletzt die Gast-Etagen der eigenen Sitzung dazu
// (nur dort sichtbar); auch sie ersetzen Etagen mit gleicher id.
//
// Raumnamen müssen systemweit eindeutig sein: buchungen.raum speichert nur
// den Namen, und die NFC-Brücke (nfc_bridge_config.py) schreibt ihn 1:1.
// ══════════════════════════════════════════════════════════

const RAUM_TYPEN = { meeting: 'Meetingraum (ganzer Raum)', sharedesk: 'ShareDesk (Einzeltische)' };
const BEREICH_TYPEN = { treppe: 'Treppe', wc: 'WC', lounge: 'Lounge', kueche: 'Teeküche', technik: 'Technik', sonstiges: 'Sonstiges' };
const MAX_TISCHE = 20;

const DATEI_ETAGEN = [];    // Rohdefinitionen aus etagen/*.js, in Lade-Reihenfolge
let ETAGEN = [];            // geprüfte Etagen (Dateien + Datenbank)
let ROOMS = [];             // alle buchbaren Räume aller Etagen
let ETAGEN_WARNUNGEN = [];  // übersprungene/fehlerhafte Etagen (für Konsole/Editor)

// Wird von jeder Etagen-Datei aufgerufen
function registriereEtage(def){ DATEI_ETAGEN.push(def); }

// ── kleine Prüf-Helfer ──
function zahlFeld(v, min, max, std){
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : std;
}
function ganzzahlFeld(v, min, max, std){ return Math.round(zahlFeld(v, min, max, std)); }
function textFeld(v, max){
  return (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, max) : '';
}
function liste(v){ return Array.isArray(v) ? v : []; }
// Rechteck auf die Etagenfläche begrenzen
function rechteckFeld(o, breite, hoehe){
  const x = zahlFeld(o && o.x, 0, breite - 1, 0);
  const y = zahlFeld(o && o.y, 0, hoehe - 1, 0);
  return { x, y, w: zahlFeld(o && o.w, 1, breite - x, 1), h: zahlFeld(o && o.h, 1, hoehe - y, 1) };
}
// Erlaubte Bildquellen: Bild im Repo (relativer Pfad) oder eingebettetes Bild
// (data:image/...). Alles andere (http:, javascript:, ...) wird verworfen.
function bildQuelleOk(url){
  if(typeof url !== 'string' || !url) return false;
  if(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(url)) return true;
  return /^[A-Za-z0-9_\-./]+\.(png|jpe?g|webp|gif|svg)$/i.test(url) && !url.includes('..') && !url.startsWith('/');
}
// "Hauptgebäude Nord" → "hauptgebaeude-nord"
function slug(text){
  return String(text).toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// Tisch-Nummerierung: [Kürzel-]<Etage>.<Raum-Nr><Tisch-Nr, 2-stellig>
// Beispiel 1.203 = Etage 1, Raum 2, Tisch 3. Diese Codes stehen in
// buchungen.tisch – Raum-Nummern daher in den Etagen-Dateien fest
// vergeben und nicht nachträglich ändern.
function tischCode(etage, raumNr, tischNr){
  return `${etage.kuerzel ? etage.kuerzel + '-' : ''}${etage.nr}.${raumNr}${String(tischNr).padStart(2, '0')}`;
}

// Prüft eine Rohdefinition und liefert { etage, fehler: [...] }.
function normalisiereEtage(def, quelle){
  const fehler = [];
  if(!def || typeof def !== 'object' || Array.isArray(def)) return { etage: null, fehler: ['keine gültige Etagen-Definition (Objekt erwartet)'] };

  const id = textFeld(def.id, 60).toLowerCase();
  if(!/^[a-z0-9-]{1,60}$/.test(id)) fehler.push(`ungültige id "${id}" (erlaubt: a–z, 0–9, Bindestrich)`);
  const gebaeude = textFeld(def.gebaeude, 60) || 'Gebäude';
  const kuerzel = textFeld(def.kuerzel, 6).replace(/[^A-Za-z0-9]/g, '');
  const nr = ganzzahlFeld(def.nr, -9, 99, 1);
  const breite = ganzzahlFeld(def.breite, 200, 4000, 960);
  const hoehe = ganzzahlFeld(def.hoehe, 150, 4000, 480);
  const etage = {
    id, gebaeude, kuerzel, nr, breite, hoehe,
    name: textFeld(def.name, 60) || `Etage ${nr}`,
    hintergrund: bildQuelleOk(def.hintergrund) ? def.hintergrund : '',
    aussenwand: def.aussenwand ? rechteckFeld(def.aussenwand, breite, hoehe) : null,
    flure: liste(def.flure).map(f => ({ ...rechteckFeld(f, breite, hoehe), name: textFeld(f.name, 40) })),
    bereiche: liste(def.bereiche).map(b => ({
      ...rechteckFeld(b, breite, hoehe),
      typ: BEREICH_TYPEN[b.typ] ? b.typ : 'sonstiges',
      name: textFeld(b.name, 40),
    })),
    tueren: liste(def.tueren).map(t => ({
      o: t.o === 'v' ? 'v' : 'h',
      x: zahlFeld(t.x, 0, breite, 0), y: zahlFeld(t.y, 0, hoehe, 0),
      len: zahlFeld(t.len, 10, 120, 32), s: Number(t.s) < 0 ? -1 : 1,
    })),
    texte: liste(def.texte).map(t => ({ x: zahlFeld(t.x, 0, breite, 0), y: zahlFeld(t.y, 0, hoehe, 0), t: textFeld(t.t, 60) })),
    raeume: [],
    quelle: quelle || 'datei',
    // wer eine Datenbank-Etage angelegt hat (nur für Bearbeitungsrechte, nie angezeigt)
    erstelltVon: Number.isFinite(def.erstellt_von) ? def.erstellt_von : null,
  };
  if(def.hintergrund && !etage.hintergrund) fehler.push('Hintergrundbild hat ein nicht erlaubtes Format');

  const namen = new Set(), nummern = new Set();
  liste(def.raeume).forEach((r, i) => {
    const name = textFeld(r && r.name, 60);
    if(!name){ fehler.push(`Raum Nr. ${i+1} hat keinen Namen`); return; }
    if(namen.has(name)){ fehler.push(`Raumname "${name}" kommt doppelt vor`); return; }
    namen.add(name);
    const typ = r.typ === 'meeting' ? 'meeting' : 'sharedesk';
    const raumNr = ganzzahlFeld(r.nr, 1, 99, i + 1);
    if(nummern.has(raumNr)) fehler.push(`Raum-Nr. ${raumNr} kommt doppelt vor (Tischcodes wären nicht eindeutig)`);
    nummern.add(raumNr);
    const anzahl = typ === 'meeting' ? 1 : ganzzahlFeld(r.tische, 1, MAX_TISCHE, 2);
    const tische = [];
    for(let t = 1; t <= anzahl; t++) tische.push({ nr: t, code: tischCode(etage, raumNr, t) });
    etage.raeume.push({
      name, typ, nr: raumNr, ...rechteckFeld(r, breite, hoehe),
      nfc: r.nfc === true,
      sub: textFeld(r.sub, 40),
      sitze: r.sitze == null ? null : ganzzahlFeld(r.sitze, 0, 12, 4),
      stirn: r.stirn == null ? null : ganzzahlFeld(r.stirn, 0, 1, 0),
      kapazitaet: anzahl, tische, etageId: id,
    });
  });
  if(!etage.raeume.length && !fehler.length) fehler.push('keine buchbaren Räume definiert');
  return { etage: fehler.length ? null : etage, fehler };
}

// Führt Datei-, Datenbank- und Gast-Etagen zusammen und baut ETAGEN/ROOMS neu auf.
function etagenAufbauen(dbDefinitionen, gastDefinitionen){
  const warnungen = [];
  const nachId = new Map();
  const hinzufuegen = (def, quelle) => {
    const { etage, fehler } = normalisiereEtage(def, quelle);
    if(fehler.length){ warnungen.push(`${quelle}-Etage "${(def && def.id) || '?'}" ignoriert: ${fehler.join('; ')}`); return; }
    nachId.set(etage.id, etage);   // Map behält die Reihenfolge des ersten Auftretens
  };
  DATEI_ETAGEN.forEach(d => hinzufuegen(d, 'datei'));
  (dbDefinitionen || []).forEach(d => hinzufuegen(d, 'datenbank'));
  (gastDefinitionen || []).forEach(d => hinzufuegen(d, 'gast'));

  const raumBesitzer = new Map();
  const ergebnis = [];
  for(const e of nachId.values()){
    const doppelt = e.raeume.find(r => raumBesitzer.has(r.name));
    if(doppelt){
      warnungen.push(`Etage "${e.id}" ignoriert: Raum "${doppelt.name}" gibt es schon in Etage "${raumBesitzer.get(doppelt.name)}"`);
      continue;
    }
    e.raeume.forEach(r => raumBesitzer.set(r.name, e.id));
    ergebnis.push(e);
  }
  ETAGEN = ergebnis;
  ROOMS = ergebnis.flatMap(e => e.raeume);
  ETAGEN_WARNUNGEN = warnungen;
  warnungen.forEach(w => console.warn('[Etagen] ' + w));
  return { etagen: ETAGEN, warnungen };
}

// ── Abfragen ──
function gebaeudeListe(){ return [...new Set(ETAGEN.map(e => e.gebaeude))]; }
function etagenVon(gebaeude){ return ETAGEN.filter(e => e.gebaeude === gebaeude); }
function etageById(id){ return ETAGEN.find(e => e.id === id) || null; }
function raumByName(name){ return ROOMS.find(r => r.name === name) || null; }
// Räume mit NFC-Reader: im Testsystem nur per Karte buchbar
function nfcRaumNamen(){ return ROOMS.filter(r => r.nfc).map(r => r.name); }

// Für Export/Editor: eine geprüfte Etage wieder als schlichte Definition
function etageAlsDefinition(e){
  const def = {
    id: e.id, gebaeude: e.gebaeude, nr: e.nr, name: e.name, breite: e.breite, hoehe: e.hoehe,
  };
  if(e.kuerzel) def.kuerzel = e.kuerzel;
  if(e.hintergrund) def.hintergrund = e.hintergrund;
  if(e.aussenwand) def.aussenwand = { ...e.aussenwand };
  if(e.flure.length) def.flure = e.flure.map(f => ({ ...f }));
  def.raeume = e.raeume.map(r => {
    const o = { name: r.name, nr: r.nr, typ: r.typ, x: r.x, y: r.y, w: r.w, h: r.h };
    if(r.typ === 'sharedesk') o.tische = r.kapazitaet;
    if(r.nfc) o.nfc = true;
    if(r.sub) o.sub = r.sub;
    if(r.sitze != null) o.sitze = r.sitze;
    if(r.stirn != null) o.stirn = r.stirn;
    return o;
  });
  if(e.bereiche.length) def.bereiche = e.bereiche.map(b => ({ ...b }));
  if(e.tueren.length) def.tueren = e.tueren.map(t => ({ ...t }));
  if(e.texte.length) def.texte = e.texte.map(t => ({ ...t }));
  return def;
}
