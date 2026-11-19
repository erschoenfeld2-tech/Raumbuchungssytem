// ══════════════════════════════════════════════════════════
// Grundriss-Renderer: erzeugt das SVG einer Etage allein aus ihrer
// Definition (siehe js/gebaeude.js). Zwei Darstellungen:
//   • ohne Hintergrundbild: Wände, Türen, Fenster, Möbel werden gezeichnet
//   • mit Hintergrundbild (z.B. eingescannter Plan): Räume als
//     halbtransparente Flächen über dem Bild, nur Tisch-Markierungen
// Klickbare Elemente tragen data-raum / data-tisch (Auswertung in js/app.js).
// ══════════════════════════════════════════════════════════

const FURN_TABLE = 'fill:#2e3250;stroke:#8891b4;stroke-width:1';
const FURN_CHAIR = 'fill:#161923;stroke:#8891b4;stroke-width:0.9';
const FURN_DESK  = 'fill:#2e3250;stroke:#8891b4;stroke-width:1';
const FURN_MON   = 'fill:#4f6ef7';

// Liegt ein Raum in der oberen Hälfte? → Beschriftung oben, sonst unten
function istOben(r, etage){ return r.y + r.h/2 < etage.hoehe/2; }

// Konferenztisch mit `seats` Stühlen je Längsseite und `ends` Stühlen an den Stirnseiten.
function furnConf(r, seats, ends){
  const tw = seats*24 + 14, th = 46;
  const tx = r.x + r.w/2 - tw/2, ty = r.y + r.h/2 - th/2 + 6;
  let s = `<rect style="${FURN_TABLE}" x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="6"/>`;
  for(let i = 0; i < seats; i++){
    const cx = tx + 19 + i*24;
    s += `<rect style="${FURN_CHAIR}" x="${cx-8}" y="${ty-12}" width="16" height="9" rx="2"/>`;
    s += `<rect style="${FURN_CHAIR}" x="${cx-8}" y="${ty+th+3}" width="16" height="9" rx="2"/>`;
  }
  if(ends){
    s += `<rect style="${FURN_CHAIR}" x="${tx-12}" y="${ty+th/2-8}" width="9" height="16" rx="2"/>`;
    s += `<rect style="${FURN_CHAIR}" x="${tx+tw+3}" y="${ty+th/2-8}" width="9" height="16" rx="2"/>`;
  }
  return { svg: s, badge: { x: tx + tw, y: ty } };
}
function furnDeskSingle(cx, cy){
  const dw = 64, dh = 30, dx = cx - dw/2, dy = cy - dh/2;
  let s = `<rect style="${FURN_DESK}" x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="3"/>`;
  s += `<rect style="${FURN_MON}" x="${dx+dw/2-8}" y="${dy+4}" width="16" height="9" rx="1"/>`;
  s += `<rect style="${FURN_CHAIR}" x="${dx+dw/2-8}" y="${dy+dh+3}" width="16" height="10" rx="3"/>`;
  return s;
}

// Mittelpunkte und Größenfaktor für n Einzeltische in einem Raum.
// 1–2 Tische: wie im ursprünglichen Grundriss; ab 3 Tischen ein Raster.
function deskLayout(r, n, oben){
  if(n <= 1) return { skala: 1, zentren: [{ x: r.x + r.w/2, y: r.y + r.h/2 }] };
  if(n === 2){
    const zentren = r.w >= r.h
      ? [{ x: r.x + r.w*0.28, y: r.y + r.h/2 + 6 }, { x: r.x + r.w*0.72, y: r.y + r.h/2 + 6 }]
      : [{ x: r.x + r.w/2, y: r.y + r.h*0.30 }, { x: r.x + r.w/2, y: r.y + r.h*0.64 }];
    return { skala: Math.max(0.45, Math.min(1, r.w/80, r.h/120)), zentren };
  }
  const rand = 30;                                  // Platz für die Raumbeschriftung
  const hoeheNutzbar = Math.max(20, r.h - rand);
  const spalten = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * r.w / hoeheNutzbar))));
  const zeilen = Math.ceil(n / spalten);
  const zw = r.w / spalten, zh = hoeheNutzbar / zeilen;
  const y0 = r.y + (oben ? rand : 0);
  const zentren = [];
  for(let i = 0; i < n; i++){
    zentren.push({ x: r.x + zw*(i % spalten + 0.5), y: y0 + zh*(Math.floor(i / spalten) + 0.5) - 6 });
  }
  return { skala: Math.max(0.45, Math.min(1, zw/86, zh/78)), zentren };
}

// Deko für nicht buchbare Bereiche (Treppe, WC, Lounge, Teeküche, Technik)
function dekorSvg(e){
  const cx = e.x + e.w/2, cy = e.y + e.h/2;
  let s = '';
  if(e.typ === 'treppe'){
    const n = 9, x1 = e.x + 22, x2 = e.x + e.w - 22, top = e.y + 34, bot = e.y + e.h - 18;
    if(x2 - x1 < 10 || bot - top < 20) return '';
    for(let i = 0; i <= n; i++){
      const y = top + i*(bot - top)/n;
      s += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#8891b4" stroke-width="1"/>`;
    }
    s += `<rect x="${x1}" y="${top}" width="${x2-x1}" height="${bot-top}" fill="none" stroke="#8891b4" stroke-width="1"/>`;
    s += `<path d="M${cx} ${bot-8} L${cx} ${top+8} M${cx-6} ${top+16} L${cx} ${top+8} L${cx+6} ${top+16}" fill="none" stroke="#b9c0e6" stroke-width="1.5"/>`;
  } else if(e.typ === 'wc'){
    const anzahl = Math.max(0, Math.min(3, Math.floor((e.w - 14) / 34)));
    for(let i = 0; i < anzahl && e.h >= 130; i++){
      const x = e.x + 14 + i*34, y = e.y + e.h - 70;
      s += `<rect style="${FURN_TABLE}" x="${x}" y="${y}" width="28" height="56" rx="2"/>`;
      s += `<ellipse cx="${x+14}" cy="${y+36}" rx="7" ry="9" style="${FURN_CHAIR}"/>`;
    }
    s += `<circle cx="${cx}" cy="${e.y+52}" r="15" fill="#fff"/>`;
    s += `<text x="${cx}" y="${e.y+57}" text-anchor="middle" font-size="13" font-weight="800" fill="#232637">WC</text>`;
  } else if(e.typ === 'lounge'){
    [[0.3,0.5],[0.7,0.62]].forEach(([fx, fy]) => {
      const x = e.x + e.w*fx, y = e.y + e.h*fy;
      s += `<circle cx="${x}" cy="${y}" r="15" style="${FURN_TABLE}"/>`;
      [[-24,0],[24,0],[0,-24],[0,24]].forEach(([dx, dy]) => { s += `<circle cx="${x+dx}" cy="${y+dy}" r="7" style="${FURN_CHAIR}"/>`; });
    });
    s += `<rect style="${FURN_TABLE}" x="${e.x+16}" y="${e.y+34}" width="${Math.max(1, e.w-32)}" height="18" rx="8"/>`;
  } else if(e.typ === 'kueche'){
    s += `<rect style="${FURN_TABLE}" x="${e.x+12}" y="${e.y+34}" width="${Math.max(1, e.w-24)}" height="18" rx="2"/>`;
    s += `<circle cx="${e.x+34}" cy="${e.y+43}" r="5" style="${FURN_CHAIR}"/><circle cx="${e.x+54}" cy="${e.y+43}" r="5" style="${FURN_CHAIR}"/>`;
    s += `<rect style="${FURN_TABLE}" x="${cx-36}" y="${cy+4}" width="72" height="36" rx="4"/>`;
    [-20, 20].forEach(dx => {
      s += `<rect style="${FURN_CHAIR}" x="${cx+dx-7}" y="${cy-8}" width="14" height="8" rx="2"/>`;
      s += `<rect style="${FURN_CHAIR}" x="${cx+dx-7}" y="${cy+42}" width="14" height="8" rx="2"/>`;
    });
  } else if(e.typ === 'technik'){
    const anzahl = Math.max(0, Math.min(3, Math.floor((e.w - 16) / 32)));
    for(let i = 0; i < anzahl && e.h > 80; i++){
      s += `<rect style="${FURN_TABLE}" x="${e.x+16+i*32}" y="${e.y+44}" width="24" height="${e.h-70}" rx="2"/>`;
      s += `<line x1="${e.x+20+i*32}" y1="${e.y+60}" x2="${e.x+36+i*32}" y2="${e.y+60}" stroke="#4f6ef7" stroke-width="2"/>`;
    }
  }
  return s;
}

// Tür: Aufschwung-Bogen (die Lücke in der Wand kommt über die Maske)
function tuerBogen(d){
  const r = d.len;
  if(d.o === 'h'){
    const sw = d.s > 0 ? 0 : 1;
    return `<path class="plan-door" d="M${d.x} ${d.y+d.s*r} L${d.x} ${d.y} M${d.x} ${d.y+d.s*r} A${r} ${r} 0 0 ${sw} ${d.x+r} ${d.y}"/>`;
  }
  const sw = d.s > 0 ? 1 : 0;
  return `<path class="plan-door" d="M${d.x+d.s*r} ${d.y} L${d.x} ${d.y} M${d.x+d.s*r} ${d.y} A${r} ${r} 0 0 ${sw} ${d.x} ${d.y+r}"/>`;
}

function badgeSvg(x, y, status, skala){
  const r = 11 * (skala || 1);
  return `<circle class="desk-badge ${status}" cx="${x}" cy="${y}" r="${r}"/>` +
         `<text class="desk-plus" x="${x}" y="${y}" style="font-size:${14*(skala||1)}px">+</text>`;
}

// Hauptfunktion. st = { selRaum, selTisch, raumStatus(raum), tischStatus(raum, code) }
// Gezeichnet wird in Ebenen, damit nichts Wichtiges verdeckt wird:
//   1. Boden (Flure, Raumflächen)  2. Möbel  3. Wände, Fenster, Türen
//   4. Beschriftungen und Tisch-Markierungen – immer obenauf.
function grundrissSvg(etage, st){
  const mitBild = !!etage.hintergrund;
  const o = etage.aussenwand;
  let boden = '', moebel = '', bau = '', oben = '';

  if(mitBild){
    boden += `<image class="plan-bild" href="${esc(etage.hintergrund)}" x="0" y="0" width="${etage.breite}" height="${etage.hoehe}" preserveAspectRatio="none"/>`;
  }

  // Flure + freie Beschriftungen
  etage.flure.forEach(fl => {
    if(!mitBild) boden += `<rect class="plan-flur" x="${fl.x}" y="${fl.y}" width="${fl.w}" height="${fl.h}"/>`;
    if(fl.name) oben += `<text class="plan-flur-label" x="${fl.x+fl.w/2}" y="${fl.y+fl.h/2+4}">${esc(fl.name)}</text>`;
  });
  etage.texte.forEach(t => { oben += `<text class="plan-text" x="${t.x}" y="${t.y}">${esc(t.t)}</text>`; });

  // Nicht buchbare Bereiche
  etage.bereiche.forEach(e => {
    if(!mitBild){
      boden += `<rect class="plan-extra" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"/>`;
      moebel += dekorSvg(e);
    }
    if(e.typ !== 'wc' && e.name) oben += `<text class="plan-sub" x="${e.x+e.w/2}" y="${istOben(e, etage) ? e.y+20 : e.y+e.h-10}">${esc(e.name)}</text>`;
  });

  // Buchbare Räume
  etage.raeume.forEach(raum => {
    const r = raum;
    const istAusgewaehlt = raum.name === st.selRaum;
    const name = esc(raum.name);
    const bildKlasse = mitBild ? ' bild' : '';

    if(raum.typ === 'meeting'){
      const status = st.raumStatus(raum);
      const cls = istAusgewaehlt ? 'selected' : `status-${status}`;
      const code = esc(raum.tische[0].code);
      const daten = `data-raum="${name}" data-tisch="${code}"`;
      let badge;
      boden += `<g class="plan-room" ${daten}><rect class="plan-fill${bildKlasse} ${cls}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
      if(!mitBild){
        const sitze = r.sitze != null ? r.sitze : Math.max(1, Math.min(8, Math.floor((r.w - 70) / 24)));
        const stirn = r.stirn != null ? r.stirn : (r.w > 260 ? 1 : 0);
        const conf = furnConf(r, sitze, stirn);
        boden += conf.svg;
        badge = conf.badge;
      } else {
        badge = { x: r.x + r.w - 18, y: r.y + 18 };
      }
      boden += `</g>`;
      oben += `<g class="plan-room" ${daten}>${badgeSvg(badge.x, badge.y, status === 'free' ? 'frei' : 'belegt')}</g>`;
      oben += `<text class="plan-label" x="${r.x+r.w/2}" y="${r.y+24}">${name}</text>`;
      oben += `<text class="plan-sub" x="${r.x+r.w/2}" y="${r.y+r.h-12}">${r.sub ? esc(r.sub) + ' · ' : ''}Tisch ${code}</text>`;
    } else {
      const oberhalb = istOben(r, etage);
      boden += `<g class="plan-room-sd" data-raum="${name}" data-tisch="${esc(raum.tische[0].code)}">`;
      boden += `<rect class="plan-fill${bildKlasse}${istAusgewaehlt ? ' selected' : ''}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/></g>`;
      oben += `<text class="plan-label" x="${r.x+r.w/2}" y="${r.y+(oberhalb ? 24 : r.h-12)}">${name}</text>`;
      const { skala, zentren } = deskLayout(r, raum.tische.length, oberhalb);
      raum.tische.forEach((t, i) => {
        const c = zentren[i];
        const status = st.tischStatus(raum, t.code);
        const istSelektiert = istAusgewaehlt && t.code === st.selTisch;
        const daten = `data-raum="${name}" data-tisch="${esc(t.code)}"`;
        if(!mitBild){
          moebel += `<g class="plan-desk-moebel" ${daten} transform="translate(${c.x} ${c.y}) scale(${skala}) translate(${-c.x} ${-c.y})">${furnDeskSingle(c.x, c.y)}</g>`;
          oben += `<g class="plan-desk${istSelektiert ? ' selected' : ''}" ${daten}>${badgeSvg(c.x + 32*skala, c.y - 15*skala, status, skala)}</g>`;
          oben += `<text class="desk-code" x="${c.x}" y="${c.y + 41*skala}">${esc(t.code)}</text>`;
        } else {
          oben += `<g class="plan-desk${istSelektiert ? ' selected' : ''}" ${daten}>${badgeSvg(c.x, c.y, status, skala)}</g>`;
          oben += `<text class="desk-code" x="${c.x}" y="${c.y + 24*skala}" style="fill:var(--text)">${esc(t.code)}</text>`;
        }
      });
    }
  });

  if(!mitBild){
    // Fenster in der Außenwand (oben/unten, mittig je Raum)
    if(o){
      const fensterRaeume = [...etage.raeume, ...etage.bereiche.filter(e => !['treppe','wc','technik'].includes(e.typ))];
      fensterRaeume.forEach(r => {
        const len = Math.min(70, r.w - 60);
        if(len < 30) return;
        const x = r.x + r.w/2 - len/2;
        if(r.y === o.y) bau += `<rect class="plan-window" x="${x}" y="${o.y-3.5}" width="${len}" height="7"/>`;
        if(r.y + r.h === o.y + o.h) bau += `<rect class="plan-window" x="${x}" y="${o.y+o.h-3.5}" width="${len}" height="7"/>`;
      });
    }
    // Wände (mit Türlücken per Maske) und Türbögen
    const maskeId = 'wandmaske-' + etage.id;
    const luecke = d => d.o === 'h' ? `<rect x="${d.x}" y="${d.y-6}" width="${d.len}" height="12" fill="#000"/>`
                                    : `<rect x="${d.x-6}" y="${d.y}" width="12" height="${d.len}" fill="#000"/>`;
    bau += `<mask id="${maskeId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${etage.breite}" height="${etage.hoehe}">
            <rect x="0" y="0" width="${etage.breite}" height="${etage.hoehe}" fill="#fff"/>${etage.tueren.map(luecke).join('')}
          </mask>`;
    bau += `<g mask="url(#${maskeId})">`;
    [...etage.raeume, ...etage.bereiche].forEach(r => {
      bau += `<rect class="plan-wall" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
    });
    if(o) bau += `<rect class="plan-wall outer" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}"/>`;
    bau += `</g>`;
    bau += etage.tueren.map(tuerBogen).join('');
  }
  return boden + moebel + `<g style="pointer-events:none">${bau}</g>` + oben;
}
