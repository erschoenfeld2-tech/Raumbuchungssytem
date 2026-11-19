// ══════════════════════════════════════════════════════════
// App-Steuerung: Zustand, Gebäude-/Etagenwechsel, Rendern, Buchen,
// Modals. Wird als letztes Skript geladen (siehe index.html).
// ══════════════════════════════════════════════════════════

let aktDatum = new Date();
let aktEtageId = null;
let currentView = 'cal';
let allBookings = [];
let modalBuchung = null;
let renderTimer = null;
let renderZaehler = 0, renderAngewendet = 0;
let letzterLadeFehler = null;
let adminTestAnsicht = false;   // Admin schaut ins Testsystem

const $ = id => document.getElementById(id);
function aktEtage(){ return etageById(aktEtageId); }
function raeumeDerEtage(){ const e = aktEtage(); return e ? e.raeume : []; }
function urlParameter(name){ return new URLSearchParams(location.search).get(name); }

// Im Testsystem sind Räume mit NFC-Reader nur per Karte buchbar,
// damit sie für die Live-Demo am Stand frei bleiben.
function webBuchungErlaubt(raumName){
  const r = raumByName(raumName);
  return !(istGast() && r && r.nfc);
}
const WEB_GESPERRT_MSG = '✗ Im Testsystem ist dieser Raum nur per NFC-Karte buchbar.';

// ── Echtbetrieb / Testsystem ──
// Testsystem = Gast, oder Admin, der über „🧪 Testsystem“ hineinschaut.
function istAdmin(){ return !!(currentUser && currentUser.ist_admin); }
function istTestModus(){ return istGast() || (istAdmin() && adminTestAnsicht); }
// Geheime Sitzung, an der die eigenen Test-Buchungen hängen
function testSitzung(){ return istGast() ? currentUser.sitzung : (istTestModus() ? currentUser.testSitzung : null); }
function testHash(){ return istGast() ? currentUser.hash : (istTestModus() ? currentUser.testHash : null); }
// Gehört eine Buchung mir? (Gäste teilen sich einen Nutzer → Erkennung über die Sitzung)
function istMeine(b){
  if(!currentUser) return false;
  if(b.test) return !!testHash() && b.gast_hash === testHash();
  return !istGast() && b.nutzer_id === currentUser.id;
}
function darfEtageBearbeiten(etage){
  if(istAdmin() || istGast()) return true;
  return etage.quelle === 'datenbank' && etage.erstelltVon === currentUser.id;
}
function darfLoeschen(b){
  if(istAdmin()) return true;
  if(istGast()) return b.test && istMeine(b);
  return !b.test && b.nutzer_id === currentUser.id;
}
// Verbleibende Änderungen im Testsystem anzeigen (Wert kommt aus der DB)
function limitAnzeigen(verbleibend){
  if(typeof verbleibend !== 'number') return;
  $('gast-limit').textContent = `Noch ${verbleibend} von ${GAST_LIMIT} Änderungen in ${GAST_LIMIT_MINUTEN} Min.`;
}
// Ist die Gast-Sitzung serverseitig abgelaufen (nach einem Tag), gibt es still eine neue
async function sitzungPruefen(fehler){
  if(!fehler || !/Sitzung abgelaufen/.test(fehler) || !istTestModus()) return false;
  const s = await neueTestSitzung();
  if(!s) return false;
  if(istGast()){ currentUser.sitzung = s.sitzung; currentUser.hash = s.hash; }
  else { currentUser.testSitzung = s.sitzung; currentUser.testHash = s.hash; }
  nutzerSpeichern();
  toast('Neue Test-Sitzung gestartet – bitte nochmal versuchen.', 'error');
  return true;
}
function bannerAktualisieren(){
  $('gast-banner').style.display = istTestModus() ? 'block' : 'none';
  $('gast-teil').style.display = istGast() ? '' : 'none';
  $('admin-test-teil').style.display = istGast() ? 'none' : '';
  $('btn-testsystem').textContent = adminTestAnsicht ? '🏢 Zurück zum Echtbetrieb' : '🧪 Testsystem';
  $('btn-testsystem').classList.toggle('aktiv', adminTestAnsicht);
}
async function adminTestsystemUmschalten(){
  if(!istAdmin()) return;
  if(!adminTestAnsicht && !currentUser.testSitzung){
    const s = await neueTestSitzung();
    if(!s){ toast('✗ Testsystem nicht verfügbar (Migration fehlt?)', 'error'); return; }
    currentUser.testSitzung = s.sitzung; currentUser.testHash = s.hash;
    nutzerSpeichern();
  }
  adminTestAnsicht = !adminTestAnsicht;
  allBookings = [];
  bannerAktualisieren();
  zeichneAlles();
  render();
}
async function meineAenderungenZuruecksetzen(){
  const { ok } = await bestaetigen('Alle deine Test-Buchungen und deine eigenen Etagen im Testsystem zurücksetzen? Änderungen anderer Gäste bleiben bestehen.', { knopf: '↺ Zurücksetzen' });
  if(!ok) return;
  const r = await gastZuruecksetzen(testSitzung());
  if(r.fehler){ if(!(await sitzungPruefen(r.fehler))) toast('✗ ' + r.fehler, 'error'); return; }
  toast(`Zurückgesetzt: ${r.buchungen} Buchung(en), ${r.etagen} Etage(n)`, 'success');
  await etagenNeuLaden();
  switchEtage(etageById(aktEtageId) ? aktEtageId : (ETAGEN[0] && ETAGEN[0].id));
}
// Admin-Passwort: aus der Anmeldung (nur im Speicher) oder verdeckt abfragen
async function passwortHolen(frage, knopf){
  if(passwortSitzung){
    const { ok } = await bestaetigen(frage, { knopf });
    return ok ? passwortSitzung : null;
  }
  const { ok, passwort } = await bestaetigen(frage + ' Zur Bestätigung bitte dein Passwort eingeben.', { knopf, passwort: true });
  return ok && passwort ? passwort : null;
}
async function testsystemKomplettLeeren(){
  const pw = await passwortHolen('Das komplette Testsystem leeren? Alle Test-Buchungen und alle Gast-Etagen aller Gäste werden gelöscht. Echte Buchungen bleiben unberührt.', '🗑 Alles löschen');
  if(!pw) return;
  const r = await testsystemLeeren(currentUser.name, pw);
  if(r.fehler){ toast('✗ ' + r.fehler, 'error'); return; }
  passwortSitzung = pw;
  toast(`Testsystem geleert: ${r.buchungen} Buchung(en), ${r.etagen} Gast-Etage(n)`, 'success');
  render();
}

// ── Datum ──
function setDatum(){
  $('datum').textContent = deDatum(aktDatum);
  $('f-datum').value = ds(aktDatum);
  $('f-datum').min = ds(new Date());
}
// Ist die Vorgabe "09:00" heute schon vorbei, nächste Viertelstunde vorschlagen
function zeitVorschlag(){
  const jetzt = new Date();
  const m = jetzt.getHours()*60 + jetzt.getMinutes();
  if(m < 9*60 || m >= 22*60) return;
  const start = Math.ceil((m + 1) / 15) * 15;
  const s = $('f-start'), e = $('f-ende');
  s._cs ? s._cs.setzen(minutenZuUhrzeit(start)) : s.value = minutenZuUhrzeit(start);
  e._cs ? e._cs.setzen(minutenZuUhrzeit(Math.min(23*60 + 59, start + 60))) : e.value = minutenZuUhrzeit(Math.min(23*60 + 59, start + 60));
}
function tag(n){ aktDatum.setDate(aktDatum.getDate() + n); setDatum(); render(); }
function heute(){ aktDatum = new Date(); setDatum(); render(); }

// ── App ein-/ausblenden ──
async function zeigeApp(){
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
  kopfAktualisieren();
  $('user-rolle').textContent = istGast() ? 'Testsystem' : 'eingeloggt';
  adminTestAnsicht = false;
  bannerAktualisieren();
  $('gast-limit').textContent = `Max. ${GAST_LIMIT} Änderungen in ${GAST_LIMIT_MINUTEN} Min.`;
  const appEl = $('app');
  appEl.classList.remove('in'); void appEl.offsetWidth; appEl.classList.add('in');
  netzAn(false);
  setDatum();
  zeitVorschlag();
  await etagenNeuLaden();
  if(!currentUser) return;   // während des Ladens abgemeldet
  const start = [urlParameter('etage'), leseGespeicherteEtage(), ETAGEN[0] && ETAGEN[0].id].find(id => id && etageById(id));
  switchEtage(start || null);
  clearInterval(renderTimer);   // nie mehrere Timer gleichzeitig (z.B. nach Ab- und Wiederanmelden)
  renderTimer = setInterval(render, AKTUALISIERUNG_MS);
}
function versteckeApp(){
  clearInterval(renderTimer); renderTimer = null;
  allBookings = [];
  modalClose(); slotModalClose(); profilSchliessen();
  $('app').style.display = 'none';
  $('login-screen').style.display = 'flex';
  netzAn(true);
}

async function etagenNeuLaden(){
  const [db, gast] = await Promise.all([ladeDbEtagen(), istGast() ? ladeGastEtagen(currentUser.sitzung) : []]);
  etagenAufbauen(db, gast);
  infoTextAktualisieren();
}
function leseGespeicherteEtage(){ try { return localStorage.getItem(SPEICHER_ETAGE); } catch(e) { return null; } }

// ── Gebäude-/Etagen-Tabs ──
function ortTabsZeichnen(){
  const etage = aktEtage();
  const gebaeude = gebaeudeListe();
  const gbBox = $('gebaeude-tabs');
  gbBox.style.display = gebaeude.length > 1 ? 'flex' : 'none';
  gbBox.innerHTML = gebaeude.map(g =>
    `<button type="button" data-gebaeude="${esc(g)}" class="${etage && etage.gebaeude === g ? 'active' : ''}">🏢 ${esc(g)}</button>`).join('');
  const etagen = etage ? etagenVon(etage.gebaeude) : [];
  $('etage-tabs').innerHTML = etagen.map(e =>
    `<button type="button" data-etage="${esc(e.id)}" class="${e.id === aktEtageId ? 'active' : ''}">${esc(e.name)}</button>`).join('')
    || '<button type="button" disabled>Keine Etagen</button>';
  // Etagen anlegen: alle Angemeldeten (Gäste nur für die eigene Sitzung).
  // Bearbeiten: Admin und Gäste immer, andere nur ihre eigenen Datenbank-Etagen.
  $('admin-tabs').style.display = currentUser ? 'flex' : 'none';
  $('btn-etage-bearbeiten').style.display = etage && darfEtageBearbeiten(etage) ? '' : 'none';
  $('btn-testsystem').style.display = istAdmin() ? '' : 'none';
}

function switchEtage(id){
  aktEtageId = id;
  if(id){
    try { localStorage.setItem(SPEICHER_ETAGE, id); } catch(e) {}
    // Jede Etage hat so ihre eigene, teilbare Adresse: index.html?etage=<id>
    try {
      const url = new URL(location.href);
      url.searchParams.set('etage', id);
      url.searchParams.delete('gast');
      history.replaceState(null, '', url);
    } catch(e) { /* z.B. in eingebetteten/abgeschotteten Ansichten nicht erlaubt – dann ohne Adresse */ }
  }
  ortTabsZeichnen();
  initRaumDropdown();
  zeichneAlles();
  render();
}
function switchView(which){
  currentView = which;
  $('cal-view').style.display = which === 'cal' ? 'block' : 'none';
  $('office-view').style.display = which === 'office' ? 'block' : 'none';
  $('view-cal').classList.toggle('active', which === 'cal');
  $('view-office').classList.toggle('active', which === 'office');
  if(which === 'office') drawFloor();
}

// ── Formular: Raum / Tisch ──
// Raum-Dropdown: gruppiert nach Art, mit Belegung des gewählten Tages
function raumEintraege(){
  const k = statusKontext();
  return raeumeDerEtage().map(r => {
    const frei = r.tische.filter(t => tischStatus(r, t.code, allBookings, k.istHeute, k.jetzt, k.datum) === 'frei').length;
    const status = frei === r.kapazitaet ? 'frei' : frei ? 'teil' : 'belegt';
    return {
      wert: r.name, text: r.name, status,
      icon: r.typ === 'meeting' ? '👥' : '🪑',
      hinweis: r.typ === 'meeting' ? (frei ? 'frei' : 'belegt') + (r.nfc ? ' · NFC' : '') : `${frei}/${r.kapazitaet} Tische frei`,
      gruppe: r.typ === 'meeting' ? 'Meetingräume' : 'ShareDesks',
    };
  }).sort((a, b) => a.gruppe.localeCompare(b.gruppe, 'de'));
}
function initRaumDropdown(){
  optionenSetzen($('f-raum'), raumEintraege());
  initTischDropdown();
  updateGanztagVisibility();
}
// Tisch-Dropdown: nur bei Räumen mit mehreren Tischen sichtbar, sonst
// wird der einzige Tisch (z.B. bei Meetingräumen) automatisch übernommen.
function initTischDropdown(){
  const raum = raumByName($('f-raum').value);
  const sel = $('f-tisch');
  if(!raum){ optionenSetzen(sel, []); $('f-tisch-wrap').style.display = 'none'; return; }
  const k = statusKontext();
  $('f-tisch-wrap').style.display = raum.tische.length > 1 ? 'block' : 'none';
  optionenSetzen(sel, raum.tische.map(t => {
    const belegt = tischStatus(raum, t.code, allBookings, k.istHeute, k.jetzt, k.datum) === 'belegt';
    return { wert: t.code, text: `Tisch ${t.code}`, status: belegt ? 'belegt' : 'frei',
             hinweis: belegt ? (k.istHeute ? 'gerade belegt' : 'an diesem Tag belegt') : 'frei' };
  }));
}
// ShareDesks dürfen ganztägig gebucht werden, Meetingräume nicht.
function updateGanztagVisibility(){
  const raum = raumByName($('f-raum').value);
  const istShareDesk = !!raum && raum.typ === 'sharedesk';
  $('ganztag-row').style.display = istShareDesk ? 'flex' : 'none';
  if(!istShareDesk){ $('f-ganztag').checked = false; toggleGanztag(); }
}
function toggleGanztag(){
  const an = $('f-ganztag').checked;
  $('f-start').disabled = an;
  $('f-ende').disabled = an;
}
function waehleTisch(raumName, code){
  $('f-raum').value = raumName;
  initTischDropdown();
  if([...$('f-tisch').options].some(o => o.value === code)) $('f-tisch').value = code;
  drawFloor();
  updateGanztagVisibility();
  toast('Ausgewählt: ' + raumName + (code ? ' · Tisch ' + code : ''), 'success');
}
// Ende automatisch nachziehen, wenn Beginn hinter/auf dem Ende liegt (+1 Stunde)
function startGeaendert(z){
  const ende = $('f-ende');
  if(ende.value <= z){
    const m = Math.min(23*60 + 59, parseInt(z.slice(0,2), 10)*60 + parseInt(z.slice(3), 10) + 60);
    ende._cs ? ende._cs.setzen(minutenZuUhrzeit(m)) : ende.value = minutenZuUhrzeit(m);
  }
}

// ── Rendern ──
function statusKontext(){
  const datum = ds(aktDatum);
  return { datum, istHeute: datum === ds(new Date()), jetzt: zeitStempel(new Date()) };
}
async function render(){
  if(!currentUser || !supa) return;
  const nr = ++renderZaehler;
  const datum = ds(aktDatum);
  const testModus = istTestModus();
  const { buchungen, fehler } = await ladeBuchungen(datum, testModus);
  // veraltete Antworten verwerfen (Tag inzwischen gewechselt / neuere Antwort schon da)
  if(!currentUser || nr < renderAngewendet || datum !== ds(aktDatum) || testModus !== istTestModus()) return;
  renderAngewendet = nr;
  if(fehler){
    if(fehler !== letzterLadeFehler) toast('Fehler beim Laden: ' + fehler, 'error');
    letzterLadeFehler = fehler;
    return;
  }
  letzterLadeFehler = null;
  allBookings = buchungen;
  zeichneAlles();
}
// Nur ins DOM schreiben, wenn sich der Inhalt geändert hat: verhindert Flackern
// und unnötiges Neu-Dekodieren eingebetteter Grundriss-Bilder alle paar Sekunden.
function setzeHtml(el, html){
  if(el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}
function zeichneAlles(){
  const k = statusKontext();
  // Im Testsystem nur Buchungen in Räumen zeigen, die man selbst kennt
  // (Gast-Etagen anderer Gäste sind privat)
  const agenda = istTestModus() ? allBookings.filter(b => raumByName(b.raum)) : allBookings;
  setzeHtml($('agenda-list'), agendaHtml(agenda, istMeine));
  drawFloor();
  optionenSetzen($('f-raum'), raumEintraege());
  initTischDropdown();
  const raeume = raeumeDerEtage();
  const kal = $('kalender');
  kal.style.minWidth = Math.max(520, 60 + raeume.length * 95) + 'px';
  setzeHtml(kal, aktEtage()
    ? kalenderHtml(raeume, allBookings, k.datum, istMeine, k.istHeute)
    : '<div class="etage-leer">Keine Etage vorhanden. Als Admin über „＋ Etage / Gebäude“ anlegen.</div>');
}
function drawFloor(){
  const svg = $('floorplan');
  const etage = aktEtage();
  if(!etage){ setzeHtml(svg, ''); return; }
  if(currentView !== 'office') return;   // wird beim Umschalten auf den Grundriss gezeichnet
  const k = statusKontext();
  svg.setAttribute('viewBox', `0 0 ${etage.breite} ${etage.hoehe}`);
  setzeHtml(svg, grundrissSvg(etage, {
    selRaum: $('f-raum').value,
    selTisch: $('f-tisch').value,
    raumStatus: r => raumStatus(r, allBookings, k.istHeute, k.jetzt, k.datum),
    tischStatus: (r, code) => tischStatus(r, code, allBookings, k.istHeute, k.jetzt, k.datum),
  }));
}
function infoTextAktualisieren(){
  const nfc = nfcRaumNamen();
  $('info-nfc').innerHTML = nfc.length
    ? `<strong>NFC:</strong> Karte am Reader (${nfc.map(esc).join(', ')}) auflegen → automatische Buchung, erneutes Auflegen verlängert.`
    : '';
}

// ── Buchen ──
async function buchungAusfuehren(raum, tisch, start, ende){
  if(!webBuchungErlaubt(raum)){ toast(WEB_GESPERRT_MSG, 'error'); return false; }
  if(ende <= zeitStempel(new Date())){ toast('✗ Dieser Zeitraum liegt in der Vergangenheit.', 'error'); return false; }
  const kap = await pruefeKapazitaet(raum, start, ende, tisch, istTestModus());
  if(!kap.ok){ toast('✗ ' + kap.msg, 'error'); return false; }
  const r = await buchungAnlegen(currentUser, testSitzung(), raum, tisch, start, ende);
  if(r.fehler){ if(!(await sitzungPruefen(r.fehler))) toast('✗ Fehler: ' + r.fehler, 'error'); return false; }
  limitAnzeigen(r.verbleibend);
  toast('✓ Buchung erstellt' + (istTestModus() ? ' (Testsystem)' : ''), 'success');
  render();
  return true;
}
async function buchen(){
  const raum = $('f-raum').value;
  const tisch = $('f-tisch').value || null;
  const datum = $('f-datum').value;
  if(!raum){ toast('Bitte einen Raum wählen.', 'error'); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(datum)){ toast('Bitte ein Datum wählen.', 'error'); return; }
  let start, ende;
  if($('f-ganztag').checked){
    start = datum + ' 00:00'; ende = datum + ' 23:59';
  } else {
    const startEl = $('f-start'), endeEl = $('f-ende');
    if(startEl._cs) startEl._cs.commit();
    if(endeEl._cs) endeEl._cs.commit();
    if(!startEl.value || !endeEl.value){ toast('Bitte alle Felder ausfüllen.', 'error'); return; }
    if(startEl.value >= endeEl.value){ toast('Startzeit muss vor Endzeit liegen.', 'error'); return; }
    start = datum + ' ' + startEl.value; ende = datum + ' ' + endeEl.value;
  }
  const btn = $('btn-buchen');
  btn.disabled = true;   // Doppelklick = Doppelbuchung verhindern
  try { await buchungAusfuehren(raum, tisch, start, ende); } finally { btn.disabled = false; }
}

// ── Buchungs-Detailmodal ──
function modalOpen(b){
  modalBuchung = b;
  $('m-raum').textContent = b.raum;
  $('m-tisch-row').style.display = b.tisch ? 'block' : 'none';
  $('m-tisch').textContent = b.tisch || '';
  $('m-nutzer').textContent = istMeine(b) ? 'Dir' : 'einer anderen Person';
  $('m-zeit').textContent = `${b.start.slice(11,16)} – ${b.ende.slice(11,16)} Uhr`;
  $('m-quelle').textContent = b.quelle === 'nfc' ? '📡 NFC-Buchung' : '🖥 Web-Buchung';
  $('m-delete').style.display = currentUser && darfLoeschen(b) ? 'block' : 'none';
  $('modal').classList.add('open');
}
function modalClose(){ $('modal').classList.remove('open'); modalBuchung = null; }
async function modalDelete(){
  if(!modalBuchung) return;
  const r = await buchungLoeschen(modalBuchung.id, currentUser);
  modalClose();
  if(r.fehler){ if(!(await sitzungPruefen(r.fehler))) toast('✗ ' + r.fehler, 'error'); return; }
  limitAnzeigen(r.verbleibend);
  toast('Buchung gelöscht', 'success');
  render();
}

// ── Zeitfenster-Modal (Listenansicht) ──
// Zeigt, welche Tische in einem Raum während eines Zeitfensters belegt
// sind, und erlaubt die Direktbuchung eines freien Tisches.
let slotAuswahl = null;
function zelleOeffnen(raumName, slotStart, slotEnde){
  const raum = raumByName(raumName);
  if(!raum) return;
  slotAuswahl = { raumName, slotStart, slotEnde };
  const treffer = allBookings.filter(b => b.raum === raumName && b.start < slotEnde && b.ende > slotStart);
  $('slot-title').textContent = `${raumName} · ${slotStart.slice(11)}–${slotEnde.slice(11)} Uhr`;
  const belegt = Math.min(maxGleichzeitig(treffer, slotStart, slotEnde), raum.kapazitaet);
  let html = `<p style="margin-bottom:10px"><strong>${belegt}/${raum.kapazitaet}</strong> Tische belegt</p>`;
  html += treffer.length ? treffer.map(b => `
      <div class="agenda-row" style="cursor:pointer" data-bid="${esc(b.id)}">
        <span class="agenda-time">${esc(b.tisch || raumName)}</span>
        <span class="agenda-raum">${esc(b.start.slice(11,16))}–${esc(b.ende.slice(11,16))}</span>
        <span class="agenda-nutzer">${wer(b, istMeine)}${b.quelle === 'nfc' ? ' · 📡' : ''}</span>
      </div>`).join('') : '<p>Alle Tische frei.</p>';
  const freieTische = raum.tische.filter(t => !treffer.some(b => b.tisch === t.code));
  if(!webBuchungErlaubt(raumName)){
    html += `<p style="margin-top:12px;color:var(--amber)">Im Testsystem nur per NFC-Karte buchbar.</p>`;
  } else if(belegt < raum.kapazitaet && freieTische.length){
    html += `<label style="margin-top:12px" for="slot-tisch-sel">Freien Tisch buchen (${slotStart.slice(11)}–${slotEnde.slice(11)} Uhr)</label>
      <select id="slot-tisch-sel">${freieTische.map(t => `<option value="${esc(t.code)}">Tisch ${esc(t.code)}</option>`).join('')}</select>
      <button type="button" class="btn-book" id="slot-buchen">✓ Buchen</button>`;
  }
  $('slot-body').innerHTML = html;
  const slotSel = $('slot-tisch-sel');
  if(slotSel) enhanceSelect(slotSel);
  $('slot-modal').classList.add('open');
}
function slotModalClose(){ $('slot-modal').classList.remove('open'); slotAuswahl = null; }
async function slotSchnellbuchen(){
  if(!slotAuswahl) return;
  const { raumName, slotStart, slotEnde } = slotAuswahl;
  const btn = $('slot-buchen');
  btn.disabled = true;
  const ok = await buchungAusfuehren(raumName, $('slot-tisch-sel').value, slotStart, slotEnde);
  if(ok) slotModalClose(); else btn.disabled = false;
}

// ── Ereignisse (Delegation über data-Attribute) ──
function buchungById(id){ return allBookings.find(b => String(b.id) === String(id)); }
function initEreignisse(){
  $('login-btn').addEventListener('click', anmelden);
  $('gast-btn').addEventListener('click', gastAnmelden);
  $('btn-abmelden').addEventListener('click', abmelden);
  $('btn-zurueck').addEventListener('click', () => tag(-1));
  $('btn-weiter').addEventListener('click', () => tag(1));
  $('btn-heute').addEventListener('click', heute);
  $('view-cal').addEventListener('click', () => switchView('cal'));
  $('view-office').addEventListener('click', () => switchView('office'));
  $('btn-buchen').addEventListener('click', buchen);
  $('f-ganztag').addEventListener('change', toggleGanztag);
  $('f-raum').addEventListener('change', () => { initTischDropdown(); drawFloor(); updateGanztagVisibility(); });
  $('f-tisch').addEventListener('change', drawFloor);
  $('f-datum').addEventListener('change', () => {
    const d = $('f-datum').value;
    if(/^\d{4}-\d{2}-\d{2}$/.test(d)){ aktDatum = new Date(d + 'T12:00'); setDatum(); render(); }
  });
  $('m-close').addEventListener('click', modalClose);
  $('m-delete').addEventListener('click', modalDelete);
  $('slot-close').addEventListener('click', slotModalClose);
  modalRegistrieren('modal', modalClose);
  modalRegistrieren('slot-modal', slotModalClose);
  modalRegistrieren('frage-modal', () => frageBeenden(false));
  $('frage-ok').addEventListener('click', () => frageBeenden(true));
  $('frage-abbrechen').addEventListener('click', () => frageBeenden(false));
  $('frage-pw').addEventListener('keydown', e => { if(e.key === 'Enter') frageBeenden(true); });
  $('btn-zuruecksetzen').addEventListener('click', meineAenderungenZuruecksetzen);
  $('btn-testsystem').addEventListener('click', adminTestsystemUmschalten);
  $('btn-test-leeren').addEventListener('click', testsystemKomplettLeeren);

  $('gebaeude-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-gebaeude]');
    if(!b) return;
    const erste = etagenVon(b.dataset.gebaeude)[0];
    if(erste) switchEtage(erste.id);
  });
  $('etage-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-etage]');
    if(b) switchEtage(b.dataset.etage);
  });
  $('floorplan').addEventListener('click', e => {
    const g = e.target.closest('[data-raum]');
    if(g) waehleTisch(g.dataset.raum, g.dataset.tisch);
  });
  $('kalender').addEventListener('click', e => {
    const z = e.target.closest('[data-raum][data-start]');
    if(z) zelleOeffnen(z.dataset.raum, z.dataset.start, z.dataset.ende);
  });
  $('agenda-list').addEventListener('click', e => {
    const r = e.target.closest('[data-bid]');
    const b = r && buchungById(r.dataset.bid);
    if(b) modalOpen(b);
  });
  $('slot-body').addEventListener('click', e => {
    if(e.target.closest('#slot-buchen')){ slotSchnellbuchen(); return; }
    const r = e.target.closest('[data-bid]');
    const b = r && buchungById(r.dataset.bid);
    if(b){ slotModalClose(); modalOpen(b); }
  });
  $('btn-etage-neu').addEventListener('click', () => editorOeffnen(null));
  $('btn-etage-bearbeiten').addEventListener('click', () => editorOeffnen(aktEtage()));

  // Enter im Login-Bildschirm = Anmelden (nicht auf dem Gast-Knopf)
  document.addEventListener('keydown', e => {
    if(e.key === 'Enter' && $('login-screen').style.display !== 'none' && e.target.id !== 'gast-btn'
       && e.target.id !== 'login-btn') anmelden();
  });
}

// ── Start ──
function start(){
  enhanceSelect($('f-raum'));
  enhanceSelect($('f-tisch'));
  // heute bereits vergangene Uhrzeiten in der Liste ausgrauen
  const vorbei = z => $('f-datum').value === ds(new Date()) && z < zeitStempel(new Date()).slice(11);
  enhanceTime($('f-start'), startGeaendert, vorbei);
  enhanceTime($('f-ende'), null, vorbei);
  initEreignisse();
  initEditor();
  initProfil();
  netzStart();

  if(!CONFIGURED || !supa){
    $('config-banner').style.display = 'block';
    $('config-banner').innerHTML = !CONFIGURED
      ? '⚠ Supabase ist noch nicht konfiguriert. Trage <code>SUPABASE_URL</code> und <code>SUPABASE_ANON_KEY</code> in <code>js/config.js</code> ein.'
      : '⚠ Die Supabase-Bibliothek konnte nicht geladen werden (<code>vendor/</code> fehlt?).';
    return;
  }
  // Direktlink zum Testsystem: index.html?gast
  if(urlParameter('gast') !== null){ gastAnmelden(); return; }
  const gespeichert = gespeicherterNutzer();
  if(gespeichert){ currentUser = gespeichert; zeigeApp(); }
}
start();
