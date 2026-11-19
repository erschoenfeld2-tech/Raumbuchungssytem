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

// ── Eigene Dropdowns im Dark-Design ──
// Die echten <select>/<input>-Elemente bleiben als Datenquelle erhalten
// (value wird weiter wie bisher gelesen/gesetzt), die Oberfläche kommt von hier.
function csSchliessen(ausser){
  document.querySelectorAll('.cs.cs-open').forEach(w => { if(w !== ausser) w.classList.remove('cs-open'); });
}
document.addEventListener('mousedown', e => { if(!e.target.closest('.cs')) csSchliessen(); });

function csAktivSetzen(list, idx){
  const opts = [...list.querySelectorAll('.cs-opt')];
  if(!opts.length) return;
  idx = Math.max(0, Math.min(opts.length-1, idx));
  opts.forEach((o,i) => o.classList.toggle('active', i === idx));
  opts[idx].scrollIntoView({block:'nearest'});
}

function enhanceSelect(sel){
  if(sel._cs){ sel._cs.refresh(); return; }
  const wrap = document.createElement('div'); wrap.className = 'cs';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs-btn';
  const list = document.createElement('div'); list.className = 'cs-list';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(btn, list, sel);
  sel.classList.add('cs-native');

  let signatur = '';
  function refresh(){
    const opts = [...sel.options];
    btn.textContent = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '–';
    const sig = opts.map(o => o.value + '|' + o.textContent).join('§') + '#' + sel.value;
    if(sig === signatur) return;
    signatur = sig;
    list.innerHTML = '';
    if(!opts.length) list.innerHTML = '<div class="cs-empty">Keine Einträge</div>';
    opts.forEach(o => {
      const d = document.createElement('div');
      d.className = 'cs-opt' + (o.value === sel.value ? ' selected' : '');
      d.textContent = o.textContent;
      d.dataset.v = o.value;
      d.onclick = () => waehle(o.value);
      list.appendChild(d);
    });
  }
  function waehle(v){
    const geaendert = sel.value !== v;
    sel.value = v;
    wrap.classList.remove('cs-open');
    if(geaendert) sel.dispatchEvent(new Event('change'));
  }
  function oeffnen(){
    csSchliessen(wrap);
    refresh();
    wrap.classList.add('cs-open');
    const idx = Math.max(0, [...list.children].findIndex(o => o.dataset.v === sel.value));
    csAktivSetzen(list, idx);
  }
  // value von außen setzen (z.B. beim Klick im Grundriss) → Anzeige mitziehen
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { get(){ return desc.get.call(sel); }, set(v){ desc.set.call(sel, v); refresh(); } });
  new MutationObserver(refresh).observe(sel, {childList:true, subtree:true});

  btn.onclick = () => wrap.classList.contains('cs-open') ? wrap.classList.remove('cs-open') : oeffnen();
  btn.onkeydown = e => {
    const offen = wrap.classList.contains('cs-open');
    const opts = [...list.querySelectorAll('.cs-opt')];
    const aktiv = opts.findIndex(o => o.classList.contains('active'));
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      if(!offen) oeffnen(); else csAktivSetzen(list, aktiv + (e.key === 'ArrowDown' ? 1 : -1));
    } else if(e.key === 'Enter' && offen && aktiv >= 0){
      e.preventDefault(); waehle(opts[aktiv].dataset.v);
    } else if(e.key === 'Escape'){ wrap.classList.remove('cs-open'); }
  };
  sel._cs = { refresh };
  refresh();
}

// Zeitfeld: frei tippbar + Auswahlliste im 15-Minuten-Raster
function enhanceTime(inp, beiAenderung){
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
      d.className = 'cs-opt' + (z === inp.value ? ' selected' : '');
      d.textContent = z; d.dataset.v = z;
      d.onmousedown = e => { e.preventDefault(); setze(z); };
      list.appendChild(d);
    });
  }
  function oeffnen(alle){
    csSchliessen(wrap);
    baue(alle ? '' : inp.value === letzter ? '' : inp.value);
    wrap.classList.add('cs-open');
    const opts = [...list.children];
    let idx = opts.findIndex(o => o.dataset.v === inp.value);
    if(idx < 0) idx = Math.max(0, opts.findIndex(o => o.dataset.v > inp.value) - 1);
    csAktivSetzen(list, idx);
  }
  function setze(z){
    inp.value = z; letzter = z;
    wrap.classList.remove('cs-open');
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
