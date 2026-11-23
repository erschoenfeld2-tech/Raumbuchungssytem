// ══════════════════════════════════════════════════════════
// Listen-/Kalenderansicht und Agenda. Erzeugt nur HTML; Klicks werden in
// js/app.js über data-Attribute ausgewertet (kein onclick mit eingesetzten
// Texten). Datenschutz: es erscheinen nie fremde Namen – eigene Buchungen
// heißen "Du", alle anderen nur "belegt". istMeine(b) entscheidet das.
// ══════════════════════════════════════════════════════════

// Pixel-Position einer Uhrzeit (Minuten) bei Kalenderbeginn startH Uhr
function pxVon(minuten, startH = H_START){ return (minuten - startH*60) / 30 * ZEILE_PX; }

// Angezeigter Zeitraum: normal H_START–H_ENDE, aber erweitert, sobald eine
// Buchung der gezeigten Räume (oder – heute – die aktuelle Uhrzeit) außerhalb
// liegt. Sonst wären z.B. ganztägige oder abendliche Buchungen unsichtbar.
function kalenderZeitraum(raeume, buchungen, istHeute){
  const namen = new Set(raeume.map(r => r.name));
  let von = H_START*60, bis = H_ENDE*60;
  buchungen.filter(b => namen.has(b.raum)).forEach(b => {
    const s = minutenVon(b.start), e = minutenVon(b.ende);
    if(!isNaN(s)) von = Math.min(von, s);
    if(!isNaN(e) && e > s) bis = Math.max(bis, e);
  });
  if(istHeute){
    const j = new Date(), m = j.getHours()*60 + j.getMinutes();
    von = Math.min(von, m); bis = Math.max(bis, m + 1);
  }
  return { startH: Math.max(0, Math.floor(von / 60)), endeH: Math.min(24, Math.ceil(bis / 60)) };
}

// Anzeige "wer": eigene = "Du", Test-Buchungen anderer Gäste = "Gast N"
// (Nummer, kein Name), echte fremde Buchungen nur "belegt" (Datenschutz).
const gastNrVon = b => b.test && b.gast_nr ? b.gast_nr : null;
function wer(b, istMeine){
  if(istMeine(b)) return 'Du';
  return gastNrVon(b) ? 'Gast ' + gastNrVon(b) : 'belegt';
}
function werKlasse(b, istMeine){
  if(istMeine(b)) return 'du';
  return gastNrVon(b) ? 'gast g' + (gastNrVon(b) % 4) : 'fremd';
}

// Belegungs-Anzeige als Punkte (●●○), nur für kleine Räume sinnvoll
function pipsHtml(belegt, kapazitaet){
  if(kapazitaet < 2 || kapazitaet > 8) return '';
  return `<span class="pips">${Array.from({ length: kapazitaet }, (_, i) => `<i${i < belegt ? ' class="an"' : ''}></i>`).join('')}</span>`;
}
// Chips "Du"/"belegt" und NFC – gemeinsam für Agenda und Zeitfenster-Modal
function chipsHtml(b, istMeine){
  return `<span class="agenda-tags"><span class="agenda-nutzer chip ${werKlasse(b, istMeine)}">${wer(b, istMeine)}</span>`
    + (b.quelle === 'nfc' ? '<span class="chip nfc" title="per NFC-Karte gebucht">📡 NFC</span>' : '') + '</span>';
}

function blockHtml(raum, spalte, anzahlSpalten, buchungen, datum, istMeine, z){
  const px = m => pxVon(m, z.startH);
  return belegungsBloecke(raum, buchungen, z.startH*60, z.endeH*60).map(blk => {
    const segs = blk.segmente.map(seg => {
      const belegt = Math.min(seg.anzahl, raum.kapazitaet);
      const status = belegt >= raum.kapazitaet ? 'busy' : 'partial';
      const mine = seg.bs.some(istMeine) ? ' mine' : '';
      const hoehe = px(seg.bis) - px(seg.von);
      // "Du" und Gast-Nummern ausschreiben, echte fremde Buchungen nur zählen
      const bekannt = [...new Set(seg.bs.filter(b => istMeine(b) || gastNrVon(b)).map(b => wer(b, istMeine)))]
        .sort((a, b) => (b === 'Du') - (a === 'Du'));
      const rest = seg.bs.filter(b => !istMeine(b) && !gastNrVon(b)).length;
      const namen = bekannt.length ? bekannt.join(' · ') + (rest ? ' + ' + rest : '') : '';
      const zeit = `${minutenZuUhrzeit(seg.von)}–${minutenZuUhrzeit(seg.bis)}`;
      return `<div class="cal-seg status-${status}${mine}${hoehe < 40 ? ' klein' : ''}" style="top:${px(seg.von)-px(blk.von)}px;height:${hoehe}px"
          title="${zeit} · ${belegt}/${raum.kapazitaet} belegt"
          data-raum="${esc(raum.name)}" data-start="${datum} ${minutenZuUhrzeit(seg.von)}" data-ende="${datum} ${minutenZuUhrzeit(seg.bis)}">
          <span class="seg-kopf"><span class="seg-zahl">${belegt}/${raum.kapazitaet}</span>${pipsHtml(belegt, raum.kapazitaet)}</span>${hoehe >= 44 && namen ? `<span class="names">${namen}</span>` : ''}${hoehe >= 80 ? `<span class="seg-zeit">${zeit}</span>` : ''}</div>`;
    }).join('');
    return `<div class="cal-block" style="top:${px(blk.von)}px;height:${px(blk.bis)-px(blk.von)}px;
        left:calc(60px + (100% - 60px) * ${spalte} / ${anzahlSpalten});width:calc((100% - 60px) / ${anzahlSpalten})">
        <div class="cal-block-in">${segs}</div></div>`;
  }).join('');
}

function kalenderHtml(raeume, buchungen, datum, istMeine, istHeute){
  if(!raeume.length) return '<div class="etage-leer">Auf dieser Etage gibt es keine buchbaren Räume.</div>';
  const cols = `60px repeat(${raeume.length}, minmax(90px, 1fr))`;
  const z = kalenderZeitraum(raeume, buchungen, istHeute);
  let html = `<div class="cal-header" style="grid-template-columns:${cols}">
    <div></div>${raeume.map(r => `<div><span class="cal-raum">${esc(r.name)}</span>
      <span class="cal-kap${r.nfc ? ' nfc' : ''}">${r.kapazitaet === 1 ? 'ganzer Raum' : r.kapazitaet + ' Tische'}${r.nfc ? ' · NFC' : ''}</span></div>`).join('')}
  </div><div class="cal-body">`;
  for(let h = z.startH; h < z.endeH; h++){
    for(let half = 0; half < 2; half++){
      const minuten = h*60 + half*30;
      const start = datum + ' ' + minutenZuUhrzeit(minuten), ende = datum + ' ' + minutenZuUhrzeit(minuten + 30);
      html += `<div class="cal-row" style="grid-template-columns:${cols}">
        <div class="cal-time">${half === 0 ? zweistellig(h) + ':00' : ''}</div>
        ${raeume.map(r => `<div class="cal-cell${half ? ' half' : ''}" data-raum="${esc(r.name)}" data-start="${start}" data-ende="${ende}"></div>`).join('')}
      </div>`;
    }
  }
  html += raeume.map((r, i) => blockHtml(r, i, raeume.length, buchungen, datum, istMeine, z)).join('');
  if(istHeute){
    const jetzt = new Date();
    const top = pxVon(jetzt.getHours()*60 + jetzt.getMinutes(), z.startH);
    if(top >= 0 && top <= (z.endeH - z.startH) * 2 * ZEILE_PX)
      html += `<div class="now" style="top:${top}px"><span class="now-zeit">${zweistellig(jetzt.getHours())}:${zweistellig(jetzt.getMinutes())}</span></div>`;
  }
  return html + '</div>';
}

// Agenda: alle Buchungen des Tages (über alle Etagen), anklickbar
function agendaHtml(buchungen, istMeine){
  if(!buchungen.length) return '<div class="agenda-empty">Keine Buchungen an diesem Tag.</div>';
  return [...buchungen].sort((a, b) => a.start.localeCompare(b.start)).map(b => `
    <div class="agenda-row${istMeine(b) ? ' mine' : ''}" data-bid="${esc(b.id)}">
      <span class="agenda-time">${esc(b.start.slice(11,16))}<i>${esc(b.ende.slice(11,16))}</i></span>
      <span class="agenda-raum">${esc(b.raum)}${b.tisch ? `<small>Tisch ${esc(b.tisch)}</small>` : ''}</span>
      ${chipsHtml(b, istMeine)}
    </div>`).join('');
}
