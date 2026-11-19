// ══════════════════════════════════════════════════════════
// Anmeldung. Es gibt keine echte Supabase-Auth (bewusste Vereinfachung,
// siehe CLAUDE.md): Passwörter werden per RPC nutzer_login() in der DB
// gegen den bcrypt-Hash geprüft – das gilt seit Migration 20261119150000
// auch für den Admin. Der angemeldete Nutzer wird im localStorage gemerkt.
// ══════════════════════════════════════════════════════════

let currentUser = null;
let pwWechselNutzer = null;   // Nutzer, der gerade sein Startpasswort ändern muss
// Admin-Passwort nur im Arbeitsspeicher (nie im localStorage) – wird zum
// Speichern von Etagen gebraucht, weil die DB das Passwort erneut prüft.
let adminPasswortSitzung = null;

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
  const user = { id: u.id, name: u.name, ist_admin: u.ist_admin };
  if(u.muss_aendern){
    pwWechselNutzer = { name: u.name, altesPw: pw, user };
    document.getElementById('pw-wechsel').style.display = 'block';
    document.getElementById('login-btn').textContent = 'Passwort speichern & anmelden';
    document.getElementById('pw-neu').focus();
    return;
  }
  if(user.ist_admin) adminPasswortSitzung = pw;
  loginAbschliessen(user);
}

async function gastAnmelden(){
  loginFehlerAus();
  if(!CONFIGURED || !supa){ loginFehler('Supabase ist nicht erreichbar oder nicht konfiguriert.'); return; }
  const { data, error } = await supa.from('nutzer_public').select('id,name').eq('name', GAST_NAME).maybeSingle();
  if(error || !data){ loginFehler('Gast-Zugang ist nicht eingerichtet (Migration fehlt).'); return; }
  loginAbschliessen({ id: data.id, name: GAST_NAME, ist_admin: false, gast: true });
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
  if(user.ist_admin) adminPasswortSitzung = neu;
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

function loginAbschliessen(user){
  currentUser = user;
  try { localStorage.setItem(SPEICHER_USER, JSON.stringify(user)); } catch(e) { /* privates Fenster o.ä. */ }
  document.getElementById('login-pw').value = '';
  zeigeApp();
}

function abmelden(){
  try { localStorage.removeItem(SPEICHER_USER); } catch(e) {}
  pwWechselZuruecksetzen();
  currentUser = null;
  adminPasswortSitzung = null;
  versteckeApp();
}

// Gespeicherte Anmeldung lesen (kaputte/alte Einträge werden verworfen)
function gespeicherterNutzer(){
  try {
    localStorage.removeItem('rb_user');   // Format vor den persönlichen Passwörtern
    const u = JSON.parse(localStorage.getItem(SPEICHER_USER) || 'null');
    return u && typeof u.id === 'number' && typeof u.name === 'string' ? u : null;
  } catch(e) { return null; }
}
