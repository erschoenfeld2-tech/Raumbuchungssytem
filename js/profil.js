// ══════════════════════════════════════════════════════════
// Profil des angemeldeten Nutzers (nicht für Gäste):
//   • Profilbild hochladen/entfernen (wird auf 192×192 px verkleinert)
//   • Nutzername ändern
//   • Passwort ändern (aktuelles Passwort wird immer verdeckt abgefragt)
//   • Übersicht „Meine Buchungen“ ab heute, nach Tagen sortiert
// Name und Bild sieht nur der Nutzer selbst (Migration 20261119170000).
// ══════════════════════════════════════════════════════════

const PROFIL_BILD_PX = 192;
let profilNeuesBild;   // undefined = unverändert, null = entfernen, Text = neues Bild

function avatarHtml(user){
  if(user && user.bild && /^data:image\/(jpeg|png|webp);base64,/.test(user.bild)) return `<img src="${esc(user.bild)}" alt="">`;
  return esc(((user && user.name) || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase());
}
function kopfAktualisieren(){
  if(!currentUser) return;
  document.getElementById('avatar').innerHTML = avatarHtml(currentUser);
  document.getElementById('user-name').textContent = currentUser.name + (currentUser.ist_admin ? ' (Administrator)' : '');
  document.getElementById('btn-profil').disabled = istGast();
  document.getElementById('btn-profil').title = istGast() ? '' : 'Mein Profil öffnen';
}

function profilMeldung(text, typ){
  const m = document.getElementById('pr-meldung');
  m.textContent = text || '';
  m.className = 'editor-meldung' + (text ? ' ' + (typ || 'ok') : '');
}
function profilBildZeigen(){
  const vorschau = { ...currentUser, bild: profilNeuesBild === undefined ? currentUser.bild : profilNeuesBild };
  document.getElementById('pr-bild').innerHTML = avatarHtml(vorschau);
  document.getElementById('pr-bild-weg').style.display = vorschau.bild ? '' : 'none';
}

async function profilOeffnen(){
  if(!currentUser || istGast()) return;
  profilNeuesBild = undefined;
  document.getElementById('pr-name').value = currentUser.name;
  ['pr-pw-neu', 'pr-pw-neu2'].forEach(id => { document.getElementById(id).value = ''; });
  profilMeldung('');
  profilBildZeigen();
  document.getElementById('profil-modal').classList.add('open');
  await profilBuchungenLaden();
}
function profilSchliessen(){ document.getElementById('profil-modal').classList.remove('open'); }

// Bild verkleinern und quadratisch zuschneiden (Mitte), als JPEG einbetten
function profilBildLaden(datei){
  if(!datei) return;
  if(!/^image\/(png|jpeg|webp|gif)$/.test(datei.type)){ profilMeldung('Bitte ein Bild (PNG, JPG, WebP oder GIF) wählen.', 'fehler'); return; }
  const leser = new FileReader();
  leser.onload = () => {
    const img = new Image();
    img.onload = () => {
      const seite = Math.min(img.naturalWidth, img.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = cv.height = PROFIL_BILD_PX;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - seite) / 2, (img.naturalHeight - seite) / 2, seite, seite, 0, 0, PROFIL_BILD_PX, PROFIL_BILD_PX);
      profilNeuesBild = cv.toDataURL('image/jpeg', 0.85);
      profilBildZeigen();
      profilMeldung('Neues Bild gewählt – mit „Profil speichern“ übernehmen.');
    };
    img.onerror = () => profilMeldung('Das Bild konnte nicht gelesen werden.', 'fehler');
    img.src = leser.result;
  };
  leser.readAsDataURL(datei);
}

async function profilSpeichernKlick(){
  const neuerName = document.getElementById('pr-name').value.trim();
  const pwNeu = document.getElementById('pr-pw-neu').value;
  const pwNeu2 = document.getElementById('pr-pw-neu2').value;
  const nameGeaendert = neuerName !== currentUser.name;
  const bildGeaendert = profilNeuesBild !== undefined;
  const pwGeaendert = !!(pwNeu || pwNeu2);
  if(!nameGeaendert && !bildGeaendert && !pwGeaendert){ profilMeldung('Es gibt keine Änderungen zu speichern.', 'fehler'); return; }
  if(nameGeaendert && neuerName.length < 2){ profilMeldung('Der Nutzername muss mindestens 2 Zeichen lang sein.', 'fehler'); return; }
  if(pwGeaendert){
    if(pwNeu.length < 6){ profilMeldung('Das neue Passwort muss mindestens 6 Zeichen lang sein.', 'fehler'); return; }
    if(pwNeu !== pwNeu2){ profilMeldung('Die neuen Passwörter stimmen nicht überein.', 'fehler'); return; }
  }
  // Passwortänderung immer mit aktuellem Passwort bestätigen, sonst das gemerkte nutzen
  let pw = pwGeaendert ? null : passwortSitzung;
  if(!pw){
    const antwort = await bestaetigen('Bitte zur Bestätigung dein aktuelles Passwort eingeben.', { knopf: 'Speichern', passwort: true });
    if(!antwort.ok || !antwort.passwort) return;
    pw = antwort.passwort;
  }
  const btn = document.getElementById('pr-speichern');
  btn.disabled = true;
  try {
    if(pwGeaendert){
      const r = await passwortAendern(currentUser.name, pw, pwNeu);
      if(r.fehler){ profilMeldung(r.fehler, 'fehler'); return; }
      pw = pwNeu;
      passwortSitzung = pwNeu;
    }
    if(nameGeaendert || bildGeaendert){
      const r = await profilSpeichern(currentUser.name, pw, nameGeaendert ? neuerName : null, bildGeaendert, bildGeaendert ? profilNeuesBild : null);
      if(r.fehler){ profilMeldung(r.fehler, 'fehler'); return; }
      currentUser.name = r.name;
      currentUser.bild = r.bild || null;
    }
    passwortSitzung = pw;
    profilNeuesBild = undefined;
    nutzerSpeichern();
    kopfAktualisieren();
    ['pr-pw-neu', 'pr-pw-neu2'].forEach(id => { document.getElementById(id).value = ''; });
    profilBildZeigen();
    profilMeldung('✓ Profil gespeichert.');
    toast('✓ Profil gespeichert', 'success');
  } finally { btn.disabled = false; }
}

// ── Meine Buchungen ──
let profilBuchungen = [];
async function profilBuchungenLaden(){
  const box = document.getElementById('pr-buchungen');
  box.innerHTML = '<div class="agenda-empty">Lade …</div>';
  const { buchungen, fehler } = await ladeMeineBuchungen(currentUser.id, ds(new Date()));
  if(fehler){ box.innerHTML = `<div class="agenda-empty">Fehler: ${esc(fehler)}</div>`; return; }
  profilBuchungen = buchungen;
  const tage = [...new Set(buchungen.map(b => b.start.slice(0, 10)))];
  document.getElementById('pr-zusammenfassung').textContent = buchungen.length
    ? `${buchungen.length} Buchung${buchungen.length > 1 ? 'en' : ''} an ${tage.length} Tag${tage.length > 1 ? 'en' : ''}`
    : '';
  if(!buchungen.length){ box.innerHTML = '<div class="agenda-empty">Du hast ab heute keine Buchungen.</div>'; return; }
  box.innerHTML = tage.map(t => {
    const datum = new Date(t + 'T12:00');
    const kopf = datum.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    return `<div class="profil-tag"><span>${esc(kopf)}</span><button type="button" data-tag="${esc(t)}">Zum Tag →</button></div>` +
      buchungen.filter(b => b.start.startsWith(t)).map(b => `
        <div class="profil-buchung">
          <span class="zeit">${esc(b.start.slice(11, 16))}–${esc(b.ende.slice(11, 16))}</span>
          <span class="ort">${esc(b.raum)}${b.tisch ? ' · Tisch ' + esc(b.tisch) : ''}${b.quelle === 'nfc' ? ' · 📡' : ''}</span>
          <button type="button" class="btn-danger" data-loeschen="${esc(b.id)}" title="Buchung löschen">🗑</button>
        </div>`).join('');
  }).join('');
}

function initProfil(){
  document.getElementById('btn-profil').addEventListener('click', profilOeffnen);
  document.getElementById('pr-schliessen').addEventListener('click', profilSchliessen);
  document.getElementById('pr-speichern').addEventListener('click', profilSpeichernKlick);
  document.getElementById('pr-bild-datei').addEventListener('change', e => { profilBildLaden(e.target.files[0]); e.target.value = ''; });
  document.getElementById('pr-bild-weg').addEventListener('click', () => { profilNeuesBild = null; profilBildZeigen(); profilMeldung('Bild wird beim Speichern entfernt.'); });
  modalRegistrieren('profil-modal', profilSchliessen);
  document.getElementById('pr-buchungen').addEventListener('click', async e => {
    const tag = e.target.closest('[data-tag]');
    if(tag){
      profilSchliessen();
      aktDatum = new Date(tag.dataset.tag + 'T12:00');
      setDatum(); render();
      return;
    }
    const weg = e.target.closest('[data-loeschen]');
    if(!weg) return;
    const b = profilBuchungen.find(x => String(x.id) === weg.dataset.loeschen);
    if(!b) return;
    const { ok } = await bestaetigen(`Buchung ${b.raum} am ${b.start.slice(8, 10)}.${b.start.slice(5, 7)}. von ${b.start.slice(11, 16)} bis ${b.ende.slice(11, 16)} Uhr löschen?`, { knopf: '🗑 Löschen' });
    if(!ok) return;
    const r = await buchungLoeschen(b.id, currentUser);
    if(r.fehler){ toast('✗ ' + r.fehler, 'error'); return; }
    toast('Buchung gelöscht', 'success');
    await profilBuchungenLaden();
    render();
  });
}
