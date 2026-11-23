// ══════════════════════════════════════════════════════════
// Belegungs-Logik (ohne DOM, ohne Datenbank – reine Funktionen,
// dadurch auch in tests/unit_tests.js prüfbar).
// Eine Buchung: { raum, tisch|null, start:'YYYY-MM-DD HH:MM', ende:'…', … }
// Zeitvergleiche funktionieren direkt als Textvergleich, weil das Format
// fest und nullengefüllt ist.
//
// WICHTIG: kapazitaetPruefen() ist in nfc_supabase_bridge.py
// (freie_plaetze) nachgebaut – Änderungen dort ebenfalls nachziehen.
// ══════════════════════════════════════════════════════════

// Höchste Zahl GLEICHZEITIG laufender Buchungen im Zeitraum [von, bis).
// (Nicht einfach "Anzahl überlappender Buchungen": 9–10 Uhr und 11–12 Uhr
// belegen einen 2er-Raum von 9–12 Uhr nie doppelt.)
function maxGleichzeitig(buchungen, von, bis){
  const relevant = buchungen.filter(b => b.start < bis && b.ende > von);
  const zeitpunkte = [von, ...relevant.map(b => b.start).filter(t => t > von && t < bis)];
  return Math.max(0, ...zeitpunkte.map(t => relevant.filter(b => b.start <= t && b.ende > t).length));
}

// Darf im Raum von start bis ende (optional an Tisch "tisch") gebucht werden?
// buchungen = alle bekannten Buchungen (werden hier auf den Raum gefiltert).
function kapazitaetPruefen(raum, buchungen, start, ende, tisch){
  if(!raum) return { ok:false, msg:'Unbekannter Raum' };
  const ueberlappend = buchungen.filter(b => b.raum === raum.name && b.start < ende && b.ende > start);
  if(tisch && ueberlappend.some(b => b.tisch === tisch)){
    return { ok:false, msg:`Tisch ${tisch} ist in diesem Zeitraum bereits belegt` };
  }
  const belegt = maxGleichzeitig(ueberlappend, start, ende);
  if(belegt >= raum.kapazitaet){
    return { ok:false, msg:`Raum ausgebucht (${belegt}/${raum.kapazitaet} belegt)` };
  }
  return { ok:true };
}

// Buchungen eines Raums, die für die Statusfarbe zählen:
// heute nur die gerade laufenden, an anderen Tagen alle des Tages.
function relevanteBuchungen(raumName, buchungen, istHeute, jetzt){
  const bs = buchungen.filter(b => b.raum === raumName);
  return istHeute ? bs.filter(b => b.start <= jetzt && b.ende > jetzt) : bs;
}
function belegtAnzahl(relevante, istHeute, jetzt, datum){
  return istHeute ? relevante.length : maxGleichzeitig(relevante, datum + ' 00:00', datum + ' 23:59:59');
}
// 'free' | 'partial' | 'busy'
function raumStatus(raum, buchungen, istHeute, jetzt, datum){
  const relevante = relevanteBuchungen(raum.name, buchungen, istHeute, jetzt);
  if(!relevante.length) return 'free';
  return belegtAnzahl(relevante, istHeute, jetzt, datum) >= raum.kapazitaet ? 'busy' : 'partial';
}
// Status eines einzelnen Tisches: 'frei' | 'belegt'. Buchungen ohne tisch
// (z.B. NFC-Check-ins, die nur den Raum kennen) zählen konservativ gegen
// die Gesamtkapazität, damit kein Tisch "frei" zeigt, wenn der Raum voll ist.
function tischStatus(raum, code, buchungen, istHeute, jetzt, datum){
  const relevante = relevanteBuchungen(raum.name, buchungen, istHeute, jetzt);
  if(relevante.some(b => b.tisch === code)) return 'belegt';
  return belegtAnzahl(relevante, istHeute, jetzt, datum) >= raum.kapazitaet ? 'belegt' : 'frei';
}

// Belegte Zeiträume eines Raums für die Kalenderansicht: zusammenhängend
// belegte Zeit = ein Block; innerhalb des Blocks wechselt nur die Farbe,
// wenn sich die Belegung ändert (z.B. 1/2 → 2/2).
function belegungsBloecke(raum, buchungen, vonMin, bisMin){
  const bs = buchungen.filter(b => b.raum === raum.name)
    .map(b => ({ s: Math.max(vonMin, minutenVon(b.start)), e: Math.min(bisMin, minutenVon(b.ende)), b }))
    .filter(x => x.e > x.s);
  const punkte = [...new Set(bs.flatMap(x => [x.s, x.e]))].sort((a, b) => a - b);
  const stuecke = [];
  for(let i = 0; i < punkte.length - 1; i++){
    const von = punkte[i], bis = punkte[i+1];
    const treffer = bs.filter(x => x.s < bis && x.e > von);
    if(treffer.length) stuecke.push({ von, bis, anzahl: treffer.length, bs: treffer.map(x => x.b) });
  }
  const bloecke = [];
  stuecke.forEach(st => {
    let blk = bloecke[bloecke.length - 1];
    if(!blk || blk.bis !== st.von){ blk = { von: st.von, bis: st.von, segmente: [] }; bloecke.push(blk); }
    const seg = blk.segmente[blk.segmente.length - 1];
    if(seg && seg.anzahl === st.anzahl){
      seg.bis = st.bis;
      st.bs.forEach(b => { if(!seg.bs.includes(b)) seg.bs.push(b); });
    } else {
      blk.segmente.push({ von: st.von, bis: st.bis, anzahl: st.anzahl, bs: [...st.bs] });
    }
    blk.bis = st.bis;
  });
  return bloecke;
}
