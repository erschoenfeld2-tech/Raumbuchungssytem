// ══════════════════════════════════════════════════════════
// Etagen-Editor (nur für Admins sichtbar)
//
// Neue Etagen/Gebäude ohne Programmieren anlegen:
//   1. Grundlage wählen: Grundriss-Bild (PNG/JPG/SVG/WebP) hochladen,
//      eine Etagen-Datei importieren (.json oder .js aus etagen/) oder leer beginnen
//   2. Auf der Fläche Räume aufziehen, verschieben, Größe ändern, benennen
//   3. Speichern: in der Datenbank (sofort für alle sichtbar) oder als Datei
//      exportieren (.js → in etagen/ ablegen und in index.html eintragen)
// Die Datenbank prüft beim Speichern das Admin-Passwort erneut
// (RPC etage_speichern, Migration 20261119150100).
// ══════════════════════════════════════════════════════════

const ED_RASTER = 5;                  // Einrasten in 5-px-Schritten
const ED_MIN = 20;                    // kleinste Raumgröße
const ED_MAX_BILD_PX = 1600;          // Bilder werden auf diese Breite verkleinert
const ED_MAX_BILD_ZEICHEN = 3500000;  // ~2,6 MB Bild (Grenze der DB-Funktion: 4 MB gesamt)

let ed = null;   // { def, auswahl:{art:'raeume'|'bereiche', i}|null, idManuell, vorschau, quelleDb, bildRoh }

function edEl(id){ return document.getElementById(id); }
function edRaster(v){ return Math.round(v / ED_RASTER) * ED_RASTER; }
function edMeldung(text, typ){
  const m = edEl('ed-meldung');
  m.textContent = text || '';
  m.className = 'editor-meldung' + (text ? ' ' + (typ || 'ok') : '');
}

function leereDefinition(){
  const gebaeude = (aktEtage() && aktEtage().gebaeude) || 'Hauptgebäude';
  const nr = Math.max(0, ...etagenVon(gebaeude).map(e => e.nr)) + 1;
  return { id: `${slug(gebaeude)}-${nr}`, gebaeude, nr, name: `Etage ${nr}`, breite: 960, hoehe: 480, raeume: [], bereiche: [] };
}

// Öffnen: etage = bestehende Etage zum Bearbeiten, null = neue Etage
function editorOeffnen(etage){
  if(!currentUser || !currentUser.ist_admin) return;
  const def = etage ? etageAlsDefinition(etage) : leereDefinition();
  def.raeume = def.raeume || []; def.bereiche = def.bereiche || [];
  ed = { def, auswahl: null, idManuell: !!etage, vorschau: false, quelleDb: !!etage && etage.quelle === 'datenbank', bildRoh: null };
  ed.stand = JSON.stringify(def);   // zum Erkennen ungespeicherter Änderungen
  edEl('ed-titel').textContent = etage ? `Etage bearbeiten: ${etage.gebaeude} · ${etage.name}` : 'Neue Etage / neues Gebäude';
  edEl('ed-pw').value = adminPasswortSitzung || '';
  edEl('ed-gebaeude-liste').innerHTML = gebaeudeListe().map(g => `<option value="${esc(g)}"></option>`).join('');
  edMeldung(etage && etage.quelle === 'datei'
    ? 'Diese Etage stammt aus einer Datei. Speichern in der Datenbank legt eine Kopie an, die die Datei-Version ersetzt.' : '');
  edFormularFuellen();
  edZeichnen();
  edEl('editor-bg').classList.add('open');
}
// nachfragen = true: bei ungespeicherten Änderungen erst bestätigen lassen
function editorSchliessen(nachfragen){
  if(!ed) return;
  if(nachfragen !== false && JSON.stringify(ed.def) !== ed.stand
     && !confirm('Ungespeicherte Änderungen an der Etage verwerfen?')) return;
  edEl('editor-bg').classList.remove('open');
  ed = null;
}

// ── Formular ⇄ Definition ──
function edFormularFuellen(){
  const d = ed.def;
  edEl('ed-gebaeude').value = d.gebaeude || '';
  edEl('ed-nr').value = d.nr;
  edEl('ed-name').value = d.name || '';
  edEl('ed-kuerzel').value = d.kuerzel || '';
  edEl('ed-id').value = d.id || '';
  edEl('ed-breite').value = d.breite;
  edEl('ed-hoehe').value = d.hoehe;
  edEl('ed-bild-entfernen').style.display = d.hintergrund ? '' : 'none';
  edEl('ed-db-loeschen').style.display = ed.quelleDb ? '' : 'none';
  edAuswahlFormular();
}
function edKopfUebernehmen(){
  const d = ed.def;
  d.gebaeude = edEl('ed-gebaeude').value.trim();
  const nr = parseInt(edEl('ed-nr').value, 10);
  d.nr = Number.isFinite(nr) ? nr : 1;   // 0 = Erdgeschoss ist gültig (nicht "|| 1")
  d.name = edEl('ed-name').value.trim();
  d.kuerzel = edEl('ed-kuerzel').value.trim();
  if(!d.kuerzel) delete d.kuerzel;
  if(!ed.idManuell){
    d.id = `${slug(d.gebaeude || 'gebaeude')}-${String(d.nr).replace('-', 'u')}`;
    edEl('ed-id').value = d.id;
  } else {
    d.id = edEl('ed-id').value.trim().toLowerCase();
  }
  d.breite = Math.max(200, Math.min(4000, parseInt(edEl('ed-breite').value, 10) || 960));
  d.hoehe = Math.max(150, Math.min(4000, parseInt(edEl('ed-hoehe').value, 10) || 480));
  edZeichnen();
}
function edAktuellesElement(){
  return ed && ed.auswahl ? ed.def[ed.auswahl.art][ed.auswahl.i] : null;
}
function edAuswahlFormular(){
  const el = edAktuellesElement();
  edEl('ed-auswahl').style.display = el ? 'block' : 'none';
  edEl('ed-keine-auswahl').style.display = el ? 'none' : 'block';
  if(!el) return;
  const istRaum = ed.auswahl.art === 'raeume';
  edEl('ed-el-name').value = el.name || '';
  const typSel = edEl('ed-el-typ');
  const typen = istRaum ? RAUM_TYPEN : BEREICH_TYPEN;
  typSel.innerHTML = Object.entries(typen).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  typSel.value = el.typ;
  edEl('ed-nur-raum').style.display = istRaum ? 'block' : 'none';
  if(istRaum){
    edEl('ed-el-nr').value = el.nr;
    edEl('ed-el-tische').value = el.typ === 'meeting' ? 1 : (el.tische || 2);
    edEl('ed-el-tische').disabled = el.typ === 'meeting';
    edEl('ed-el-nfc').checked = !!el.nfc;
    edEl('ed-el-sub').value = el.sub || '';
  }
}
function edAuswahlUebernehmen(){
  const el = edAktuellesElement();
  if(!el) return;
  el.name = edEl('ed-el-name').value;
  el.typ = edEl('ed-el-typ').value;
  if(ed.auswahl.art === 'raeume'){
    el.nr = parseInt(edEl('ed-el-nr').value, 10) || 1;
    if(el.typ === 'meeting'){ delete el.tische; } else { el.tische = Math.max(1, Math.min(MAX_TISCHE, parseInt(edEl('ed-el-tische').value, 10) || 2)); }
    edEl('ed-el-tische').disabled = el.typ === 'meeting';
    if(edEl('ed-el-nfc').checked) el.nfc = true; else delete el.nfc;
    const sub = edEl('ed-el-sub').value.trim();
    if(sub) el.sub = sub; else delete el.sub;
  }
  edZeichnen();
}

// ── Zeichenfläche ──
function edZeichnen(){
  const svg = edEl('ed-svg');
  const d = ed.def;
  svg.setAttribute('viewBox', `0 0 ${d.breite} ${d.hoehe}`);
  if(ed.vorschau){
    const { etage, fehler } = normalisiereEtage(d, 'vorschau');
    svg.innerHTML = etage
      ? grundrissSvg(etage, { selRaum: null, selTisch: null, raumStatus: () => 'free', tischStatus: () => 'frei' })
      : `<text x="20" y="40" fill="#f87171" font-size="16">Vorschau nicht möglich: ${esc(fehler.join('; '))}</text>`;
    return;
  }
  let s = `<rect x="0" y="0" width="${d.breite}" height="${d.hoehe}" fill="#12141c"/>`;
  if(d.hintergrund) s += `<image href="${esc(d.hintergrund)}" x="0" y="0" width="${d.breite}" height="${d.hoehe}" preserveAspectRatio="none" style="pointer-events:none"/>`;
  // Hilfsraster alle 40 px
  for(let x = 40; x < d.breite; x += 40) s += `<line x1="${x}" y1="0" x2="${x}" y2="${d.hoehe}" stroke="rgba(136,145,180,.08)"/>`;
  for(let y = 40; y < d.hoehe; y += 40) s += `<line x1="0" y1="${y}" x2="${d.breite}" y2="${y}" stroke="rgba(136,145,180,.08)"/>`;
  ['bereiche', 'raeume'].forEach(art => {
    d[art].forEach((el, i) => {
      const aktiv = ed.auswahl && ed.auswahl.art === art && ed.auswahl.i === i;
      const info = art === 'raeume' ? (el.typ === 'meeting' ? 'Meetingraum' : `${el.tische || 2} Tische`) + (el.nfc ? ' · NFC' : '') : (BEREICH_TYPEN[el.typ] || '');
      s += `<g class="ed-raum${art === 'bereiche' ? ' bereich' : ''}${aktiv ? ' aktiv' : ''}" data-art="${art}" data-i="${i}">
        <rect class="ed-flaeche" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}"/>
        <text x="${el.x + el.w/2}" y="${el.y + el.h/2}">${esc(el.name || '(ohne Name)')}</text>
        <text x="${el.x + el.w/2}" y="${el.y + el.h/2 + 17}" style="font-size:11px;font-weight:400">${esc(info)}</text>`;
      if(aktiv) s += `<rect class="ed-griff" data-griff="1" x="${el.x + el.w - 7}" y="${el.y + el.h - 7}" width="14" height="14" rx="3"/>`;
      s += `</g>`;
    });
  });
  s += `<rect id="ed-neu" class="ed-neu" x="0" y="0" width="0" height="0" style="display:none"/>`;
  svg.innerHTML = s;
}

function edPunkt(e){
  const svg = edEl('ed-svg');
  const p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  return { x: Math.max(0, Math.min(ed.def.breite, q.x)), y: Math.max(0, Math.min(ed.def.hoehe, q.y)) };
}
let edZug = null;   // laufende Maus-Aktion: { modus:'neu'|'schieben'|'groesse', … }
function edZeigerRunter(e){
  if(!ed || ed.vorschau || e.button > 0) return;
  const p = edPunkt(e);
  const g = e.target.closest('[data-art]');
  edEl('ed-svg').setPointerCapture(e.pointerId);
  if(g){
    ed.auswahl = { art: g.dataset.art, i: +g.dataset.i };
    const el = edAktuellesElement();
    edZug = e.target.dataset.griff ? { modus: 'groesse', el } : { modus: 'schieben', el, dx: p.x - el.x, dy: p.y - el.y };
    edAuswahlFormular();
    edZeichnen();
  } else {
    edZug = { modus: 'neu', x0: edRaster(p.x), y0: edRaster(p.y) };
  }
}
function edZeigerBewegt(e){
  if(!edZug) return;
  const p = edPunkt(e), d = ed.def, el = edZug.el;
  if(edZug.modus === 'neu'){
    const r = edZug.r = { x: Math.min(edZug.x0, edRaster(p.x)), y: Math.min(edZug.y0, edRaster(p.y)),
      w: Math.abs(edRaster(p.x) - edZug.x0), h: Math.abs(edRaster(p.y) - edZug.y0) };
    const neu = edEl('ed-neu');
    neu.style.display = '';
    ['x','y'].forEach(k => neu.setAttribute(k, r[k]));
    neu.setAttribute('width', r.w); neu.setAttribute('height', r.h);
    return;
  }
  if(edZug.modus === 'schieben'){
    el.x = Math.max(0, Math.min(d.breite - el.w, edRaster(p.x - edZug.dx)));
    el.y = Math.max(0, Math.min(d.hoehe - el.h, edRaster(p.y - edZug.dy)));
  } else {
    el.w = Math.max(ED_MIN, Math.min(d.breite - el.x, edRaster(p.x - el.x)));
    el.h = Math.max(ED_MIN, Math.min(d.hoehe - el.y, edRaster(p.y - el.y)));
  }
  edZeichnen();
}
function edZeigerHoch(){
  if(!edZug) return;
  const zug = edZug;
  edZug = null;
  if(zug.modus !== 'neu') return;
  const r = zug.r;
  if(!r || r.w < ED_MIN || r.h < ED_MIN){
    ed.auswahl = null; edAuswahlFormular(); edZeichnen();   // Klick ins Leere = Auswahl aufheben
    return;
  }
  const art = edEl('ed-neu-art').value;
  const liste = ed.def[art];
  if(art === 'raeume'){
    const nr = Math.max(0, ...liste.map(x => x.nr || 0)) + 1;
    liste.push({ name: `Raum ${ed.def.nr}.${nr}`, nr, typ: 'sharedesk', tische: 2, ...r });
  } else {
    liste.push({ name: 'Bereich', typ: 'sonstiges', ...r });
  }
  ed.auswahl = { art, i: liste.length - 1 };
  edAuswahlFormular();
  edZeichnen();
  edEl('ed-el-name').focus();
  edEl('ed-el-name').select();
}
function edElementLoeschen(){
  if(!ed || !ed.auswahl) return;
  ed.def[ed.auswahl.art].splice(ed.auswahl.i, 1);
  ed.auswahl = null;
  edAuswahlFormular();
  edZeichnen();
}
function edElementKopieren(){
  const el = edAktuellesElement();
  if(!el) return;
  const kopie = { ...el, x: Math.min(ed.def.breite - el.w, el.x + 20), y: Math.min(ed.def.hoehe - el.h, el.y + 20) };
  if(ed.auswahl.art === 'raeume'){
    kopie.nr = Math.max(0, ...ed.def.raeume.map(x => x.nr || 0)) + 1;
    kopie.name = el.name + ' (Kopie)';
  }
  ed.def[ed.auswahl.art].push(kopie);
  ed.auswahl = { art: ed.auswahl.art, i: ed.def[ed.auswahl.art].length - 1 };
  edAuswahlFormular();
  edZeichnen();
}

// ── Grundlage: Bild ──
function edBildLaden(datei){
  if(!datei) return;
  if(!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(datei.type)){ edMeldung('Bitte ein Bild (PNG, JPG, WebP, GIF oder SVG) wählen.', 'fehler'); return; }
  const leser = new FileReader();
  leser.onload = () => {
    const img = new Image();
    img.onload = () => { ed.bildRoh = img; edBildVerarbeiten(true); };
    img.onerror = () => edMeldung('Das Bild konnte nicht gelesen werden.', 'fehler');
    img.src = leser.result;
  };
  leser.readAsDataURL(datei);
}
// Verkleinert das Bild, invertiert es auf Wunsch für das Dark-Design
// (typische Grundrisse sind schwarz auf weiß) und bettet es als data-URL ein.
function edBildVerarbeiten(groesseAnpassen){
  const img = ed.bildRoh;
  if(!img) return;
  const w0 = img.naturalWidth || 960, h0 = img.naturalHeight || 480;
  const faktor = Math.min(1, ED_MAX_BILD_PX / w0);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w0 * faktor));
  cv.height = Math.max(1, Math.round(h0 * faktor));
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, cv.width, cv.height);   // transparente Flächen wie Papier behandeln
  c.drawImage(img, 0, 0, cv.width, cv.height);
  if(edEl('ed-invert').checked){
    const pix = c.getImageData(0, 0, cv.width, cv.height);
    const p = pix.data;
    for(let i = 0; i < p.length; i += 4){
      // invertieren und in Richtung Theme-Hintergrund (#0f1117) abdunkeln
      p[i]   = 15 + (255 - p[i])   * 0.72;
      p[i+1] = 17 + (255 - p[i+1]) * 0.74;
      p[i+2] = 23 + (255 - p[i+2]) * 0.80;
    }
    c.putImageData(pix, 0, 0);
  }
  let url = cv.toDataURL('image/jpeg', 0.82);
  for(let q = 0.7; url.length > ED_MAX_BILD_ZEICHEN && q >= 0.3; q -= 0.1) url = cv.toDataURL('image/jpeg', q);
  if(url.length > ED_MAX_BILD_ZEICHEN){ edMeldung('Das Bild ist zu groß. Bitte ein kleineres Bild verwenden.', 'fehler'); return; }
  ed.def.hintergrund = url;
  if(groesseAnpassen){
    // Zeichenfläche bekommt das Seitenverhältnis des Bildes (Breite 960)
    ed.def.breite = 960;
    ed.def.hoehe = Math.max(150, Math.min(4000, Math.round(960 * h0 / w0)));
  }
  edFormularFuellen();
  edZeichnen();
  edMeldung('Bild geladen. Jetzt auf dem Bild Räume aufziehen (Maus gedrückt halten und ziehen).');
}

// ── Grundlage: Datei (.json oder Etagen-Datei .js) ──
// Etagen-Dateien sind JavaScript (registriereEtage({...})). Sie werden NICHT
// ausgeführt, sondern hier in JSON übersetzt: Kommentare raus, Schlüssel und
// '…'-Texte in "…" umwandeln, überzählige Kommas entfernen.
function jsObjektZuJson(text){
  const aufruf = text.indexOf('registriereEtage(');
  const start = text.indexOf('{', aufruf < 0 ? 0 : aufruf);
  if(start < 0) throw new Error('Kein Objekt { … } in der Datei gefunden.');
  const ESCAPES = { n:'\n', t:'\t', r:'\r', b:'\b', f:'\f', v:'\v', 0:'\0' };
  let aus = '', i = start, tiefe = 0;
  while(i < text.length){
    const z = text[i];
    if(z === '/' && text[i+1] === '/'){ while(i < text.length && text[i] !== '\n') i++; continue; }
    if(z === '/' && text[i+1] === '*'){ const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if(z === '"' || z === "'" || z === '`'){
      // Text-Literal lesen und Escape-Sequenzen auflösen
      let j = i + 1, inhalt = '';
      while(j < text.length && text[j] !== z){
        if(text[j] === '\\'){
          const n = text[j+1] || '';
          if(n === 'u' && /^[0-9a-fA-F]{4}$/.test(text.substr(j+2, 4))){ inhalt += String.fromCharCode(parseInt(text.substr(j+2, 4), 16)); j += 6; continue; }
          inhalt += ESCAPES[n] !== undefined ? ESCAPES[n] : n;
          j += 2; continue;
        }
        if(z === '`' && text[j] === '$' && text[j+1] === '{') throw new Error('Platzhalter ${…} sind in Etagen-Dateien nicht erlaubt.');
        inhalt += text[j]; j++;
      }
      if(j >= text.length) throw new Error('Nicht geschlossener Text in der Datei.');
      aus += JSON.stringify(inhalt);
      i = j + 1; continue;
    }
    if(/[A-Za-z_$]/.test(z)){
      let j = i;
      while(j < text.length && /[\w$]/.test(text[j])) j++;
      const wort = text.slice(i, j);
      const rest = text.slice(j).match(/^\s*:/);
      aus += rest ? JSON.stringify(wort) : (['true','false','null'].includes(wort) ? wort : (() => { throw new Error(`Unerwartetes Wort "${wort}" – nur Werte erlaubt, kein Programmcode.`); })());
      i = j; continue;
    }
    if(z === '{' || z === '[') tiefe++;
    if(z === '}' || z === ']'){ tiefe--; aus = aus.replace(/,\s*$/, ''); }
    aus += z; i++;
    if(tiefe === 0) break;
  }
  return JSON.parse(aus);
}
function edDateiImportieren(datei){
  if(!datei) return;
  const leser = new FileReader();
  leser.onload = () => {
    try {
      const text = String(leser.result);
      const def = /\.json$/i.test(datei.name) ? JSON.parse(text) : jsObjektZuJson(text);
      const { fehler } = normalisiereEtage(def, 'import');
      def.raeume = Array.isArray(def.raeume) ? def.raeume : [];
      def.bereiche = Array.isArray(def.bereiche) ? def.bereiche : [];
      ed.def = def; ed.auswahl = null; ed.idManuell = true; ed.quelleDb = false;
      edFormularFuellen();
      edZeichnen();
      edMeldung(fehler.length ? 'Datei geladen, aber noch fehlerhaft:\n• ' + fehler.join('\n• ') : `Datei "${datei.name}" geladen (${def.raeume.length} Räume).`, fehler.length ? 'fehler' : 'ok');
    } catch(err){
      edMeldung('Datei konnte nicht gelesen werden: ' + err.message, 'fehler');
    }
  };
  leser.readAsText(datei);
}

// ── Prüfen, Speichern, Exportieren ──
// Liefert die geprüfte Etage oder null (Fehler stehen dann in der Meldung)
function edPruefen(){
  edKopfUebernehmen();
  const { etage, fehler } = normalisiereEtage(ed.def, 'datenbank');
  const doppelt = etage ? etage.raeume.filter(r => {
    const vorhanden = raumByName(r.name);
    return vorhanden && vorhanden.etageId !== etage.id;
  }) : [];
  doppelt.forEach(r => fehler.push(`Raumname "${r.name}" gibt es schon in Etage "${raumByName(r.name).etageId}" (Namen müssen eindeutig sein)`));
  if(fehler.length){ edMeldung('Bitte korrigieren:\n• ' + fehler.join('\n• '), 'fehler'); return null; }
  return etage;
}
async function edInDbSpeichern(){
  const etage = edPruefen();
  if(!etage) return;
  const pw = edEl('ed-pw').value;
  if(!pw){ edMeldung('Zum Speichern das Admin-Passwort eingeben.', 'fehler'); edEl('ed-pw').focus(); return; }
  const def = etageAlsDefinition(etage);
  const btn = edEl('ed-speichern');
  btn.disabled = true;
  const { fehler, id } = await etageSpeichernDb(currentUser.name, pw, def);
  btn.disabled = false;
  if(fehler){ edMeldung('Speichern fehlgeschlagen: ' + fehler, 'fehler'); return; }
  adminPasswortSitzung = pw;
  await etagenNeuLaden();
  editorSchliessen(false);
  switchEtage(etageById(id) ? id : (ETAGEN[0] && ETAGEN[0].id));
  toast('✓ Etage gespeichert', 'success');
}
async function edDbLoeschen(){
  if(!ed || !ed.quelleDb) return;
  const pw = edEl('ed-pw').value;
  if(!pw){ edMeldung('Zum Löschen das Admin-Passwort eingeben.', 'fehler'); return; }
  if(!confirm(`Datenbank-Etage "${ed.def.id}" wirklich löschen? Buchungen bleiben erhalten, die Räume sind aber nicht mehr sichtbar.`)) return;
  const fehler = await etageLoeschenDb(currentUser.name, pw, ed.def.id);
  if(fehler){ edMeldung('Löschen fehlgeschlagen: ' + fehler, 'fehler'); return; }
  adminPasswortSitzung = pw;
  await etagenNeuLaden();
  editorSchliessen(false);
  switchEtage(etageById(aktEtageId) ? aktEtageId : (ETAGEN[0] && ETAGEN[0].id));
  toast('Etage gelöscht', 'success');
}
function edHerunterladen(dateiname, inhalt, typ){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([inhalt], { type: typ }));
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function edExportJson(){
  const etage = edPruefen();
  if(!etage) return;
  edHerunterladen(`${etage.id}.json`, JSON.stringify(etageAlsDefinition(etage), null, 2), 'application/json');
  edMeldung('JSON exportiert – kann hier jederzeit wieder importiert werden.');
}
function edExportJs(){
  const etage = edPruefen();
  if(!etage) return;
  const datei = `${etage.gebaeude.trim() ? slug(etage.gebaeude) : 'etage'}-etage-${etage.nr}.js`;
  const kopf = `// ══════════════════════════════════════════════════════════
// ${etage.gebaeude} · ${etage.name}  (exportiert aus dem Etagen-Editor)
// Einbinden: Datei nach etagen/${datei} legen und in index.html im Block
// "ETAGEN" ergänzen:  <script src="etagen/${datei}"></script>
// Aufbau und Felder: siehe etagen/_vorlage-etage.js
// ══════════════════════════════════════════════════════════
`;
  edHerunterladen(datei, kopf + 'registriereEtage(' + JSON.stringify(etageAlsDefinition(etage), null, 2) + ');\n', 'text/javascript');
  edMeldung(`Etagen-Datei ${datei} exportiert – nach etagen/ kopieren und in index.html eintragen.`);
}

// ── Verdrahtung ──
function initEditor(){
  modalRegistrieren('editor-bg', () => editorSchliessen(true));
  edEl('ed-schliessen').addEventListener('click', () => editorSchliessen(true));
  edEl('ed-bild').addEventListener('change', e => { edBildLaden(e.target.files[0]); e.target.value = ''; });
  edEl('ed-datei').addEventListener('change', e => { edDateiImportieren(e.target.files[0]); e.target.value = ''; });
  edEl('ed-leer').addEventListener('click', () => {
    if(ed.def.raeume.length && !confirm('Alle Räume dieser Zeichnung verwerfen?')) return;
    ed.def = leereDefinition(); ed.auswahl = null; ed.idManuell = false; ed.quelleDb = false; ed.bildRoh = null;
    edFormularFuellen(); edZeichnen(); edMeldung('');
  });
  edEl('ed-invert').addEventListener('change', () => edBildVerarbeiten(false));
  edEl('ed-bild-entfernen').addEventListener('click', () => { delete ed.def.hintergrund; ed.bildRoh = null; edFormularFuellen(); edZeichnen(); });
  ['ed-gebaeude','ed-nr','ed-name','ed-kuerzel','ed-breite','ed-hoehe'].forEach(id => edEl(id).addEventListener('input', edKopfUebernehmen));
  edEl('ed-id').addEventListener('input', () => { ed.idManuell = true; edKopfUebernehmen(); });
  ['ed-el-name','ed-el-nr','ed-el-tische','ed-el-sub'].forEach(id => edEl(id).addEventListener('input', edAuswahlUebernehmen));
  ['ed-el-typ','ed-el-nfc'].forEach(id => edEl(id).addEventListener('change', edAuswahlUebernehmen));
  edEl('ed-el-loeschen').addEventListener('click', edElementLoeschen);
  edEl('ed-el-kopieren').addEventListener('click', edElementKopieren);
  edEl('ed-vorschau').addEventListener('click', () => {
    edKopfUebernehmen();
    ed.vorschau = !ed.vorschau;
    edEl('ed-vorschau').textContent = ed.vorschau ? '✎ Zurück zum Bearbeiten' : '👁 Vorschau wie in der App';
    edZeichnen();
  });
  edEl('ed-speichern').addEventListener('click', edInDbSpeichern);
  edEl('ed-export-json').addEventListener('click', edExportJson);
  edEl('ed-export-js').addEventListener('click', edExportJs);
  edEl('ed-db-loeschen').addEventListener('click', edDbLoeschen);
  const svg = edEl('ed-svg');
  svg.addEventListener('pointerdown', edZeigerRunter);
  svg.addEventListener('pointermove', edZeigerBewegt);
  svg.addEventListener('pointerup', edZeigerHoch);
  svg.addEventListener('pointercancel', edZeigerHoch);
  document.addEventListener('keydown', e => {
    if(!ed || !edEl('editor-bg').classList.contains('open')) return;
    if((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){
      e.preventDefault(); edElementLoeschen();
    }
  });
}
