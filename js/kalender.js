// ══════════════════════════════════════════════════════════
// Listen-/Kalenderansicht und Agenda. Erzeugt nur HTML; Klicks werden in
// js/app.js über data-Attribute ausgewertet (kein onclick mit eingesetzten
// Texten). Datenschutz: es erscheinen nie fremde Namen – eigene Buchungen
// heißen "Du", alle anderen nur "belegt". istMeine(b) entscheidet das.
// ══════════════════════════════════════════════════════════

function pxVon(minuten){ return (minuten - H_START*60) / 30 * ZEILE_PX; }

function wer(b, istMeine){ return istMeine(b) ? 'Du' : 'belegt'; }

// Belegungs-Anzeige als Punkte (●●○), nur für kleine Räume sinnvoll
function pipsHtml(belegt, kapazitaet){
  if(kapazitaet < 2 || kapazitaet > 8) return '';
  return `<span class="pips">${Array.from({ length: kapazitaet }, (_, i) => `<i${i < belegt ? ' class="an"' : ''}></i>`).join('')}</span>`;
}
// Chips "Du"/"belegt" und NFC – gemeinsam für Agenda und Zeitfenster-Modal
function chipsHtml(b, istMeine){
  return `<span class="agenda-tags"><span class="agenda-nutzer chip ${istMeine(b) ? 'du' : 'fremd'}">${wer(b, istMeine)}</span>`
    + (b.quelle === 'nfc' ? '<span class="chip nfc" title="per NFC-Karte gebucht">📡 NFC</span>' : '') + '</span>';
}

function blockHtml(raum, spalte, anzahlSpalten, buchungen, datum, istMeine){
  return belegungsBloecke(raum, buchungen, H_START*60, H_ENDE*60).map(blk => {
    const segs = blk.segmente.map(seg => {
      const belegt = Math.min(seg.anzahl, raum.kapazitaet);
      const status = belegt >= raum.kapazitaet ? 'busy' : 'partial';
      const mine = seg.bs.some(istMeine) ? ' mine' : '';
      const hoehe = pxVon(seg.bis) - pxVon(seg.von);
      const namen = seg.bs.some(istMeine) ? 'Du' + (seg.bs.length > 1 ? ' + ' + (seg.bs.length - 1) : '') : '';
      const zeit = `${minutenZuUhrzeit(seg.von)}–${minutenZuUhrzeit(seg.bis)}`;
      return `<div class="cal-seg status-${status}${mine}${hoehe < 40 ? ' klein' : ''}" style="top:${pxVon(seg.von)-pxVon(blk.von)}px;height:${hoehe}px"
          title="${zeit} · ${belegt}/${raum.kapazitaet} belegt"
          data-raum="${esc(raum.name)}" data-start="${datum} ${minutenZuUhrzeit(seg.von)}" data-ende="${datum} ${minutenZuUhrzeit(seg.bis)}">
          <span class="seg-kopf"><span class="seg-zahl">${belegt}/${raum.kapazitaet}</span>${pipsHtml(belegt, raum.kapazitaet)}</span>${hoehe >= 44 && namen ? `<span class="names">${namen}</span>` : ''}${hoehe >= 80 ? `<span class="seg-zeit">${zeit}</span>` : ''}</div>`;
    }).join('');
    return `<div class="cal-block" style="top:${pxVon(blk.von)}px;height:${pxVon(blk.bis)-pxVon(blk.von)}px;
        left:calc(60px + (100% - 60px) * ${spalte} / ${anzahlSpalten});width:calc((100% - 60px) / ${anzahlSpalten})">
        <div class="cal-block-in">${segs}</div></div>`;
  }).join('');
}

function kalenderHtml(raeume, buchungen, datum, istMeine, istHeute){
  if(!raeume.length) return '<div class="etage-leer">Auf dieser Etage gibt es keine buchbaren Räume.</div>';
  const cols = `60px repeat(${raeume.length}, minmax(90px, 1fr))`;
  let html = `<div class="cal-header" style="grid-template-columns:${cols}">
    <div></div>${raeume.map(r => `<div><span class="cal-raum">${esc(r.name)}</span>
      <span class="cal-kap${r.nfc ? ' nfc' : ''}">${r.kapazitaet === 1 ? 'ganzer Raum' : r.kapazitaet + ' Tische'}${r.nfc ? ' · NFC' : ''}</span></div>`).join('')}
  </div><div class="cal-body">`;
  for(let h = H_START; h < H_ENDE; h++){
    for(let half = 0; half < 2; half++){
      const minuten = h*60 + half*30;
      const start = datum + ' ' + minutenZuUhrzeit(minuten), ende = datum + ' ' + minutenZuUhrzeit(minuten + 30);
      html += `<div class="cal-row" style="grid-template-columns:${cols}">
        <div class="cal-time">${half === 0 ? zweistellig(h) + ':00' : ''}</div>
        ${raeume.map(r => `<div class="cal-cell${half ? ' half' : ''}" data-raum="${esc(r.name)}" data-start="${start}" data-ende="${ende}"></div>`).join('')}
      </div>`;
    }
  }
  html += raeume.map((r, i) => blockHtml(r, i, raeume.length, buchungen, datum, istMeine)).join('');
  if(istHeute){
    const jetzt = new Date();
    const top = pxVon(jetzt.getHours()*60 + jetzt.getMinutes());
    if(top >= 0 && top <= (H_ENDE - H_START) * 2 * ZEILE_PX)
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
