// ══════════════════════════════════════════════════════════
// Allgemeine UI-Helfer: HTML-Escaping, Datum/Uhrzeit, Toast, Modals,
// eigene Dropdowns und Zeitfelder im Dark-Design.
// ══════════════════════════════════════════════════════════

// Jeder Text aus Datenbank oder Etagen-Dateien wird vor dem Einsetzen in
// innerHTML hiermit entschärft (Namen wie "O'Brien" oder <script> dürfen
// weder das Layout noch die Seite kaputt machen).
function esc(wert){
  return String(wert ?? '').replace(/[&<>"']/g, z => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[z]));
}

// ── Datum / Uhrzeit ──
// Buchungszeiten sind Texte im Format 'YYYY-MM-DD HH:MM' in LOKALER Zeit.
// Wichtig: nicht toISOString() benutzen – das liefert UTC und zwischen
// 0 und 1/2 Uhr nachts (MEZ/MESZ) den Vortag.
function zweistellig(n){ return String(n).padStart(2, '0'); }
function ds(d){ return `${d.getFullYear()}-${zweistellig(d.getMonth()+1)}-${zweistellig(d.getDate())}`; }
function zeitStempel(d){ return `${ds(d)} ${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`; }
function deDatum(d){ return d.toLocaleDateString('de-DE', {weekday:'long', day:'2-digit', month:'long', year:'numeric'}); }
function minutenZuUhrzeit(m){ return zweistellig(Math.floor(m/60)) + ':' + zweistellig(m % 60); }
function minutenVon(str){ return parseInt(str.slice(11,13), 10)*60 + parseInt(str.slice(14,16), 10); }

// "9", "930", "9:30", "09.30" → "09:30"; ungültig → null
function parseZeit(t){
  t = String(t).trim().replace(/[.hH]/g, ':');
  let h, m;
  if(t.includes(':')){
    const teile = t.split(':');
    if(teile.length !== 2 || !/^\d{1,2}$/.test(teile[0]) || !/^\d{0,2}$/.test(teile[1])) return null;
    h = +teile[0]; m = +(teile[1] || 0);
  } else {
    if(!/^\d{1,4}$/.test(t)) return null;
    if(t.length <= 2){ h = +t; m = 0; }
    else { h = +t.slice(0, t.length-2); m = +t.slice(-2); }
  }
  if(h > 23 || m > 59) return null;
  return zweistellig(h) + ':' + zweistellig(m);
}

// ── Toast ──
let toastTimer = null;
function toast(msg, typ){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + (typ || 'success');
  clearTimeout(toastTimer);   // sonst blendet ein alter Timer eine neue Meldung zu früh aus
  toastTimer = setTimeout(() => t.className = '', 3500);
}

// ── Modals: per Escape oder Klick auf den Hintergrund schließen ──
const modalSchliesser = {};   // id → Schließ-Funktion
function modalRegistrieren(id, schliessen){
  modalSchliesser[id] = schliessen;
  document.getElementById(id).addEventListener('mousedown', e => { if(e.target.id === id) schliessen(); });
}
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || document.querySelector('.cs.cs-open')) return;
  const offen = [...document.querySelectorAll('.modal-bg.open, .editor-bg.open')].pop();
  if(offen && modalSchliesser[offen.id]) modalSchliesser[offen.id]();
});

// ── Bestätigungsdialog in der Seite (statt confirm(), das manche Browser-
// Ansichten blockieren). Optional mit Passwortfeld (Eingabe bleibt verdeckt).
// Liefert ein Promise: { ok:true/false, passwort }
let frageAntwort = null;
function bestaetigen(text, optionen){
  const o = optionen || {};
  document.getElementById('frage-text').textContent = text;
  document.getElementById('frage-ok').textContent = o.knopf || 'Ja';
  const pwZeile = document.getElementById('frage-pw-zeile');
  const pw = document.getElementById('frage-pw');
  pwZeile.style.display = o.passwort ? 'block' : 'none';
  pw.value = '';
  document.getElementById('frage-modal').classList.add('open');
  (o.passwort ? pw : document.getElementById('frage-ok')).focus();
  return new Promise(ok => { frageAntwort = ok; });
}
function frageBeenden(ok){
  const pw = document.getElementById('frage-pw');
  document.getElementById('frage-modal').classList.remove('open');
  const antwort = frageAntwort;
  frageAntwort = null;
  if(antwort) antwort({ ok, passwort: ok ? pw.value : '' });
  pw.value = '';
}

// ── Eigene Dropdowns im Dark-Design ──
// Die echten <select>/<input>-Elemente bleiben als Datenquelle erhalten
// (value wird weiter wie bisher gelesen/gesetzt), die Oberfläche kommt von hier.
// Zusatzinfos je <option> über data-Attribute:
//   data-hinweis="2 Tische frei"   → grauer Zusatztext rechts
//   data-status="frei|teil|belegt" → farbiger Punkt
//   data-icon="🪑"                  → Symbol vor dem Text
// <optgroup label="…"> wird als Gruppenüberschrift angezeigt. Ab 8 Einträgen
// gibt es ein Suchfeld. Ist unten zu wenig Platz, öffnet die Liste nach oben.
function csSchliessen(ausser){
  document.querySelectorAll('.cs.cs-open').forEach(w => { if(w !== ausser) w.classList.remove('cs-open', 'cs-oben'); });
}
document.addEventListener('mousedown', e => { if(!e.target.closest('.cs')) csSchliessen(); });

function csAktivSetzen(list, idx){
  const opts = [...list.querySelectorAll('.cs-opt:not(.cs-weg):not(.cs-aus)')];
  list.querySelectorAll('.cs-opt.active').forEach(o => o.classList.remove('active'));
  if(!opts.length) return;
  idx = Math.max(0, Math.min(opts.length-1, idx));
  opts[idx].classList.add('active');
  opts[idx].scrollIntoView({block:'nearest'});
}
// Liste nach oben öffnen, wenn darunter nicht genug Platz ist
function csRichtung(wrap, list){
  const r = wrap.getBoundingClientRect();
  const hoehe = Math.min(list.scrollHeight || 260, 280);
  const unten = innerHeight - r.bottom, oben = r.top;
  wrap.classList.toggle('cs-oben', unten < hoehe + 12 && oben > unten);
}
function csOptionHtml(o, ausgewaehlt){
  const d = o.dataset || {};
  return `${d.status ? `<span class="cs-punkt ${esc(d.status)}"></span>` : ''}`
    + `${d.icon ? `<span class="cs-icon">${esc(d.icon)}</span>` : ''}`
    + `<span class="cs-text">${esc(o.textContent)}</span>`
    + `${d.hinweis ? `<span class="cs-hinweis">${esc(d.hinweis)}</span>` : ''}`
    + `<span class="cs-haken" aria-hidden="true">${ausgewaehlt ? '✓' : ''}</span>`;
}

function enhanceSelect(sel){
  if(sel._cs){ sel._cs.refresh(); return; }
  const wrap = document.createElement('div'); wrap.className = 'cs';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  const list = document.createElement('div'); list.className = 'cs-list'; list.setAttribute('role', 'listbox');
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(btn, list, sel);
  sel.classList.add('cs-native');
  // Label des Originals soll den neuen Knopf fokussieren
  if(sel.id){ const lbl = document.querySelector(`label[for="${sel.id}"]`); if(lbl) lbl.addEventListener('click', e => { e.preventDefault(); btn.focus(); }); }

  let signatur = '', suche = null;
  function refresh(){
    const opts = [...sel.options];
    const gewaehlt = sel.selectedOptions[0];
    btn.innerHTML = gewaehlt ? `<span class="cs-btn-inhalt">${csOptionHtml(gewaehlt, false)}</span>` : '<span class="cs-leer">–</span>';
    const sig = opts.map(o => o.value + '|' + o.textContent + '|' + JSON.stringify(o.dataset) + '|' + (o.parentNode.label || '')).join('§') + '#' + sel.value;
    if(sig === signatur) return;
    signatur = sig;
    list.innerHTML = '';
    suche = null;
    if(opts.length >= 8){
      suche = document.createElement('input');
      suche.type = 'search'; suche.className = 'cs-suche'; suche.placeholder = 'Suchen …'; suche.setAttribute('aria-label', 'Einträge durchsuchen');
      suche.addEventListener('input', () => filtern(suche.value));
      suche.addEventListener('keydown', tasten);
      list.appendChild(suche);
    }
    if(!opts.length) list.insertAdjacentHTML('beforeend', '<div class="cs-empty">Keine Einträge</div>');
    let letzteGruppe = null;
    opts.forEach(o => {
      const gruppe = o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : null;
      if(gruppe && gruppe !== letzteGruppe){
        const g = document.createElement('div'); g.className = 'cs-gruppe'; g.textContent = gruppe;
        list.appendChild(g);
      }
      letzteGruppe = gruppe;
      const d = document.createElement('div');
      const ausgewaehlt = o.value === sel.value;
      d.className = 'cs-opt' + (ausgewaehlt ? ' selected' : '') + (o.disabled ? ' cs-aus' : '');
      d.setAttribute('role', 'option'); d.setAttribute('aria-selected', ausgewaehlt);
      d.innerHTML = csOptionHtml(o, ausgewaehlt);
      d.dataset.v = o.value;
      if(!o.disabled) d.onclick = () => waehle(o.value);
      list.appendChild(d);
    });
    list.insertAdjacentHTML('beforeend', '<div class="cs-empty cs-keintreffer" style="display:none">Kein Treffer</div>');
  }
  function filtern(text){
    const t = text.trim().toLowerCase();
    let treffer = 0;
    list.querySelectorAll('.cs-opt').forEach(o => {
      const passt = !t || o.textContent.toLowerCase().includes(t);
      o.classList.toggle('cs-weg', !passt);
      if(passt) treffer++;
    });
    list.querySelectorAll('.cs-gruppe').forEach(g => { g.style.display = t ? 'none' : ''; });
    list.querySelector('.cs-keintreffer').style.display = treffer ? 'none' : '';
    csAktivSetzen(list, 0);
  }
  function waehle(v){
    const geaendert = sel.value !== v;
    sel.value = v;
    wrap.classList.remove('cs-open', 'cs-oben');
    btn.focus();
    if(geaendert) sel.dispatchEvent(new Event('change'));
  }
  function oeffnen(){
    csSchliessen(wrap);
    refresh();
    if(suche){ suche.value = ''; filtern(''); }
    wrap.classList.add('cs-open');
    csRichtung(wrap, list);
    const sichtbar = [...list.querySelectorAll('.cs-opt:not(.cs-aus)')];
    csAktivSetzen(list, Math.max(0, sichtbar.findIndex(o => o.dataset.v === sel.value)));
    if(suche) suche.focus();
  }
  function tasten(e){
    const offen = wrap.classList.contains('cs-open');
    const opts = [...list.querySelectorAll('.cs-opt:not(.cs-weg):not(.cs-aus)')];
    const aktiv = opts.findIndex(o => o.classList.contains('active'));
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      if(!offen) oeffnen(); else csAktivSetzen(list, aktiv + (e.key === 'ArrowDown' ? 1 : -1));
    } else if(e.key === 'Home' || e.key === 'End'){
      if(offen){ e.preventDefault(); csAktivSetzen(list, e.key === 'Home' ? 0 : opts.length - 1); }
    } else if(e.key === 'Enter' || (e.key === ' ' && e.target === btn)){
      e.preventDefault();
      if(offen && aktiv >= 0) waehle(opts[aktiv].dataset.v); else if(!offen) oeffnen();
    } else if(e.key === 'Escape'){
      if(offen){ e.stopPropagation(); wrap.classList.remove('cs-open', 'cs-oben'); btn.focus(); }
    } else if(e.key === 'Tab'){
      wrap.classList.remove('cs-open', 'cs-oben');
    } else if(!suche && offen && e.key.length === 1){
      // Tippen springt zum ersten Eintrag mit diesem Anfangsbuchstaben
      const i = opts.findIndex(o => o.querySelector('.cs-text').textContent.toLowerCase().startsWith(e.key.toLowerCase()));
      if(i >= 0) csAktivSetzen(list, i);
    }
  }
  // value von außen setzen (z.B. beim Klick im Grundriss) → Anzeige mitziehen
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { get(){ return desc.get.call(sel); }, set(v){ desc.set.call(sel, v); refresh(); } });
  new MutationObserver(refresh).observe(sel, {childList:true, subtree:true, attributes:true});

  btn.onclick = () => wrap.classList.contains('cs-open') ? wrap.classList.remove('cs-open', 'cs-oben') : oeffnen();
  btn.onkeydown = tasten;
  sel._cs = { refresh };
  refresh();
}

// Optionen eines <select> aus einer Liste setzen – nur bei Änderung, sonst
// flackert ein offenes Dropdown. eintraege: [{ wert, text, hinweis, status, icon, gruppe, aus }]
function optionenSetzen(sel, eintraege){
  const sig = JSON.stringify(eintraege);
  if(sel._sig === sig) return;
  sel._sig = sig;
  const bisher = sel.value;
  const knoten = [];
  let gruppe = null;
  eintraege.forEach(e => {
    const o = new Option(e.text, e.wert);
    if(e.hinweis) o.dataset.hinweis = e.hinweis;
    if(e.status) o.dataset.status = e.status;
    if(e.icon) o.dataset.icon = e.icon;
    if(e.aus) o.disabled = true;
    if(e.gruppe){
      if(!gruppe || gruppe.label !== e.gruppe){ gruppe = document.createElement('optgroup'); gruppe.label = e.gruppe; knoten.push(gruppe); }
      gruppe.appendChild(o);
    } else { gruppe = null; knoten.push(o); }
  });
  sel.replaceChildren(...knoten);
  if(eintraege.some(e => e.wert === bisher)) sel.value = bisher;
  else if(sel._cs) sel._cs.refresh();
}

// Zeitfeld: frei tippbar + Auswahlliste im 15-Minuten-Raster.
// istVergangen(z) (optional): Uhrzeiten, die heute schon vorbei sind, werden ausgegraut.
function enhanceTime(inp, beiAenderung, istVergangen){
  const wrap = document.createElement('div'); wrap.className = 'cs cs-time';
  const list = document.createElement('div'); list.className = 'cs-list';
  const clock = document.createElement('button'); clock.type = 'button'; clock.className = 'cs-clock';
  clock.tabIndex = -1; clock.textContent = '🕒';
  inp.parentNode.insertBefore(wrap, inp);
  wrap.append(inp, clock, list);

  const zeiten = [];
  for(let m = 6*60; m <= 22*60; m += 15) zeiten.push(minutenZuUhrzeit(m));
  let letzter = parseZeit(inp.value) || '09:00';

  function baue(filter){
    list.innerHTML = '';
    const f = (filter || '').replace(/[^0-9]/g, '');
    const treffer = zeiten.filter(z => !f || z.replace(':','').startsWith(f) || z.replace(':','').replace(/^0/,'').startsWith(f));
    if(!treffer.length){ list.innerHTML = '<div class="cs-empty">Eigene Uhrzeit mit Enter übernehmen</div>'; return; }
    treffer.forEach(z => {
      const d = document.createElement('div');
      const vorbei = istVergangen && istVergangen(z);
      d.className = 'cs-opt' + (z === inp.value ? ' selected' : '') + (vorbei ? ' cs-vorbei' : '');
      d.innerHTML = `<span class="cs-text">${z}</span>${vorbei ? '<span class="cs-hinweis">vorbei</span>' : ''}<span class="cs-haken">${z === inp.value ? '✓' : ''}</span>`;
      d.dataset.v = z;
      d.onmousedown = e => { e.preventDefault(); setze(z); };
      list.appendChild(d);
    });
  }
  function oeffnen(alle){
    csSchliessen(wrap);
    baue(alle ? '' : inp.value === letzter ? '' : inp.value);
    wrap.classList.add('cs-open');
    csRichtung(wrap, list);
    const opts = [...list.children];
    let idx = opts.findIndex(o => o.dataset.v === inp.value);
    if(idx < 0) idx = Math.max(0, opts.findIndex(o => o.dataset.v > inp.value) - 1);
    csAktivSetzen(list, idx);
  }
  function setze(z){
    inp.value = z; letzter = z;
    wrap.classList.remove('cs-open', 'cs-oben');
    if(beiAenderung) beiAenderung(z);
  }
  function commit(){
    const z = parseZeit(inp.value);
    if(z){ setze(z); }
    else {
      inp.value = letzter;
      inp.classList.add('cs-error');
      setTimeout(() => inp.classList.remove('cs-error'), 400);
      wrap.classList.remove('cs-open');
    }
  }
  inp.addEventListener('focus', () => { oeffnen(true); inp.select(); });
  inp.addEventListener('click', () => { if(!wrap.classList.contains('cs-open')) oeffnen(true); });
  inp.addEventListener('input', () => { baue(inp.value); wrap.classList.add('cs-open'); csAktivSetzen(list, 0); });
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    const opts = [...list.querySelectorAll('.cs-opt')];
    const aktiv = opts.findIndex(o => o.classList.contains('active'));
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      if(!wrap.classList.contains('cs-open')) oeffnen(true);
      else csAktivSetzen(list, aktiv + (e.key === 'ArrowDown' ? 1 : -1));
    } else if(e.key === 'Enter'){
      e.preventDefault();
      // getippte Zeit hat Vorrang, sonst die markierte Listenzeile
      if(inp.value === letzter && wrap.classList.contains('cs-open') && aktiv >= 0) setze(opts[aktiv].dataset.v);
      else commit();
    } else if(e.key === 'Escape'){
      inp.value = letzter; wrap.classList.remove('cs-open'); inp.blur();
    }
  });
  clock.onmousedown = e => e.preventDefault();
  clock.onclick = () => wrap.classList.contains('cs-open') ? wrap.classList.remove('cs-open') : (inp.focus(), oeffnen(true));
  // setzen(): Wert von außen setzen, ohne dass der nächste blur ihn zurücksetzt
  inp._cs = { commit, setzen(z){ inp.value = z; letzter = z; } };
}
