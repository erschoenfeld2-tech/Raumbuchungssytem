// ══════════════════════════════════════════════════════════
// Anmeldung. Es gibt keine echte Supabase-Auth (bewusste Vereinfachung,
// siehe CLAUDE.md): Passwörter werden per RPC nutzer_login() in der DB
// gegen den bcrypt-Hash geprüft – seit Migration 20261119150000 auch für
// den Admin. Der angemeldete Nutzer wird im localStorage gemerkt.
//
// Datenschutz: Nutzernamen anderer Personen und Passwörter werden nie
// angezeigt. Den eigenen Namen liefert nur nutzer_login() nach korrektem
// Passwort; Passwortfelder sind immer verdeckt.
//
// Gäste bekommen eine eigene, geheime Sitzung (gast_sitzung_starten()).
// Daran hängen ihre Test-Buchungen und Gast-Etagen; der SHA-256-Hash der
// Sitzung (gast_hash) erkennt eigene Test-Buchungen in der Liste.
// ══════════════════════════════════════════════════════════

let currentUser = null;
let pwWechselNutzer = null;   // Nutzer, der gerade sein Startpasswort ändern muss
// Eigenes Passwort nur im Arbeitsspeicher (nie im localStorage, nie angezeigt) –
// wird für Etagen speichern, Profil und Admin-Aktionen gebraucht, weil die DB
// das Passwort jedes Mal erneut prüft. Nach dem Neuladen wird verdeckt nachgefragt.
let passwortSitzung = null;

const istGast = () => !!(currentUser && currentUser.gast);

function loginFehler(text){
  const err = document.getElementById('login-err');
  err.textContent = text; err.className = 'login-error show';
}
function loginFehlerAus(){ document.getElementById('login-err').className = 'login-error'; }

async function anmelden(){
  if(pwWechselNutzer) return passwortWechseln();
  const name = document.getElementById('login-name').value.trim();
  const pw = document.getElementById('login-pw').value;
  loginFehlerAus();
  if(!name || !pw){ loginFehler('Bitte alle Felder ausfüllen.'); return; }
  if(!CONFIGURED || !supa){ loginFehler('Supabase ist nicht erreichbar oder nicht konfiguriert.'); return; }
  const { data, error } = await supa.rpc('nutzer_login', { p_name: name, p_passwort: pw });
  if(error){ loginFehler('Anmeldung fehlgeschlagen: ' + error.message); return; }
  if(!data || !data.length){ loginFehler('Nutzername oder Passwort falsch'); return; }
  const u = data[0];
  const user = { id: u.id, name: u.name, ist_admin: u.ist_admin, bild: u.bild || null };
  if(u.muss_aendern){
    pwWechselNutzer = { name: u.name, altesPw: pw, user };
    document.getElementById('pw-wechsel').style.display = 'block';
    document.getElementById('login-btn').textContent = 'Passwort speichern & anmelden';
    document.getElementById('pw-neu').focus();
    return;
  }
  passwortSitzung = pw;
  loginAbschliessen(user);
}

// SHA-256 als Hex-Text (wie encode(sha256(...), 'hex') in der Datenbank)
async function sha256Hex(text){
  if(!window.crypto || !crypto.subtle) return '';   // ohne sichere Verbindung: eigene Test-Buchungen nicht markierbar
  const puffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(puffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Nummer einer Gast-Sitzung ("Gast 3"). undefined = unbekannt (z.B. Migration
// fehlt), null = Sitzung existiert nicht mehr (abgelaufen / Testsystem geleert).
async function gastNummerHolen(sitzung){
  const { data, error } = await supa.rpc('gast_nummer', { p_sitzung: sitzung });
  return error ? undefined : data;
}
const gastAnzeigeName = nr => nr ? `${GAST_NAME} ${nr}` : GAST_NAME;
// Neue geheime Test-Sitzung (für Gäste und für den Admin im Testsystem)
async function neueTestSitzung(){
  const { data, error } = await supa.rpc('gast_sitzung_starten');
  if(error || !data) return null;
  return { sitzung: data, hash: await sha256Hex(data), nummer: (await gastNummerHolen(data)) || null };
}
// Beim Start: gespeicherte Gast-Sitzung prüfen, Nummer nachladen; ist die
// Sitzung weg (nach einem Tag oder "Testsystem leeren"), still eine neue holen.
async function gastSitzungAuffrischen(){
  if(!istGast()) return;
  let nr = await gastNummerHolen(currentUser.sitzung);
  if(nr === null){
    const s = await neueTestSitzung();
    if(!s) return;
    Object.assign(currentUser, { sitzung: s.sitzung, hash: s.hash });
    nr = s.nummer;
  }
  if(nr === undefined) return;
  currentUser.nummer = nr;
  currentUser.name = gastAnzeigeName(nr);
  nutzerSpeichern();
}

async function gastAnmelden(){
  loginFehlerAus();
  if(!CONFIGURED || !supa){ loginFehler('Supabase ist nicht erreichbar oder nicht konfiguriert.'); return; }
  const s = await neueTestSitzung();
  if(!s){ loginFehler('Das Testsystem ist gerade nicht verfügbar (Migration fehlt?).'); return; }
  loginAbschliessen({ id: null, name: gastAnzeigeName(s.nummer), ist_admin: false, gast: true,
    sitzung: s.sitzung, hash: s.hash, nummer: s.nummer });
}

async function passwortWechseln(){
  const neu = document.getElementById('pw-neu').value;
  const neu2 = document.getElementById('pw-neu2').value;
  loginFehlerAus();
  if(neu.length < 6){ loginFehler('Das neue Passwort muss mindestens 6 Zeichen lang sein.'); return; }
  if(neu !== neu2){ loginFehler('Die Passwörter stimmen nicht überein.'); return; }
  const { data, error } = await supa.rpc('nutzer_passwort_aendern',
    { p_name: pwWechselNutzer.name, p_altes: pwWechselNutzer.altesPw, p_neues: neu });
  if(error){ loginFehler(error.message); return; }
  if(!data){ loginFehler('Passwortwechsel fehlgeschlagen.'); return; }
  const user = pwWechselNutzer.user;
  passwortSitzung = neu;
  pwWechselZuruecksetzen();
  loginAbschliessen(user);
}
function pwWechselZuruecksetzen(){
  pwWechselNutzer = null;
  document.getElementById('pw-wechsel').style.display = 'none';
  document.getElementById('login-btn').textContent = 'Anmelden';
  document.getElementById('pw-neu').value = '';
  document.getElementById('pw-neu2').value = '';
}

function nutzerSpeichern(){
  try { localStorage.setItem(SPEICHER_USER, JSON.stringify(currentUser)); } catch(e) { /* privates Fenster o.ä. */ }
}
function loginAbschliessen(user){
  currentUser = user;
  nutzerSpeichern();
  document.getElementById('login-pw').value = '';
  zeigeApp();
}

function abmelden(){
  try { localStorage.removeItem(SPEICHER_USER); } catch(e) {}
  pwWechselZuruecksetzen();
  currentUser = null;
  passwortSitzung = null;
  versteckeApp();
}

// Gespeicherte Anmeldung lesen (kaputte/alte Einträge werden verworfen)
function gespeicherterNutzer(){
  try {
    localStorage.removeItem('rb_user');   // Format vor den persönlichen Passwörtern
    const u = JSON.parse(localStorage.getItem(SPEICHER_USER) || 'null');
    if(!u || typeof u.name !== 'string') return null;
    if(u.gast) return typeof u.sitzung === 'string' ? u : null;   // alte Gast-Anmeldung ohne Sitzung verwerfen
    return typeof u.id === 'number' ? u : null;
  } catch(e) { return null; }
}
