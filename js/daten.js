// ══════════════════════════════════════════════════════════
// Datenzugriff (Supabase / PostgREST). Alle Lese-/Schreibzugriffe der
// App laufen über diese Datei.
//
// Echtbetrieb vs. Testsystem: Test-Buchungen tragen test = true, hängen an
// einer geheimen Gast-Sitzung und entstehen nur über gast_buchen(). Im
// Testsystem gilt ein Limit von GAST_LIMIT Änderungen in GAST_LIMIT_MINUTEN
// Minuten je Sitzung (geprüft in der DB, Migration 20261119160000).
// Nutzernamen sind über den anon key nicht lesbar – Buchungen werden ohne
// Namen geladen und in der Oberfläche als "Du" bzw. "belegt" angezeigt.
// ══════════════════════════════════════════════════════════

const BUCHUNG_SPALTEN = 'id,raum,tisch,nutzer_id,start,ende,quelle,test,gast_hash';

// Etagen aus der Datenbank (angelegt über den Etagen-Editor). Fehlt die
// Tabelle noch (Migration nicht deployt), läuft die App mit den Datei-Etagen weiter.
async function ladeDbEtagen(){
  if(!supa) return [];
  const { data, error } = await supa.from('etagen').select('id,definition,erstellt_von').order('id');
  if(error){ console.warn('[Etagen] Datenbank-Etagen nicht geladen:', error.message); return []; }
  return data.map(z => ({ ...z.definition, erstellt_von: z.erstellt_von }));
}
// Eigene Gast-Etagen (nur für diese Sitzung sichtbar)
async function ladeGastEtagen(sitzung){
  if(!supa || !sitzung) return [];
  const { data, error } = await supa.rpc('gast_etagen_laden', { p_sitzung: sitzung });
  if(error){ console.warn('[Etagen] Gast-Etagen nicht geladen:', error.message); return []; }
  return data || [];
}

// PostgREST-Filter "raum ist einer dieser Namen" (Namen in Anführungszeichen,
// damit Leerzeichen/Kommas im Namen den Filter nicht zerlegen)
function raumInFilter(namen){
  return `raum.in.(${namen.map(n => '"' + String(n).replace(/["\\]/g, '\\$&') + '"').join(',')})`;
}

async function testBuchungenAufraeumen(){
  const { error } = await supa.rpc('test_buchungen_aufraeumen');
  if(error) console.warn('Aufräumen der Test-Buchungen fehlgeschlagen:', error.message);
}

// Alle Buchungen eines Tages. testModus: Testsystem (Gast oder Admin-Ansicht)
async function ladeBuchungen(datum, testModus){
  if(testModus) await testBuchungenAufraeumen();
  let q = supa.from('buchungen').select(BUCHUNG_SPALTEN).like('start', datum + '%');
  // Echtbetrieb: nur echte Buchungen. Testsystem: Test-Buchungen + die per
  // NFC gebuchten Räume, damit man deren Belegung auch dort sieht.
  if(testModus){
    const nfc = nfcRaumNamen();
    q = nfc.length ? q.or(`test.eq.true,${raumInFilter(nfc)}`) : q.eq('test', true);
  } else {
    q = q.eq('test', false);
  }
  const { data, error } = await q.order('start');
  if(error) return { fehler: error.message, buchungen: [] };
  return { buchungen: data };
}

// Kapazitätsprüfung direkt gegen die Datenbank (aktueller Stand, nicht der
// zuletzt geladene) – Logik in kapazitaetPruefen() (js/belegung.js).
async function pruefeKapazitaet(raumName, start, ende, tisch, testModus){
  const raum = raumByName(raumName);
  if(!raum) return { ok:false, msg:`Raum "${raumName}" ist unbekannt` };
  const { data, error } = await supa.from('buchungen')
    .select('id,raum,tisch,start,ende')
    .eq('raum', raumName)
    .eq('test', !!testModus)
    .lt('start', ende)
    .gt('ende', start);
  if(error) return { ok:false, msg:'Fehler bei Kapazitätsprüfung: ' + error.message };
  return kapazitaetPruefen(raum, data, start, ende, tisch);
}

// Ergebnis aller schreibenden Aufrufe: { fehler } oder { verbleibend } (Testsystem)
async function buchungAnlegen(user, testSitzung, raum, tisch, start, ende){
  if(testSitzung){
    const { data, error } = await supa.rpc('gast_buchen',
      { p_sitzung: testSitzung, p_raum: raum, p_tisch: tisch || '', p_start: start, p_ende: ende });
    return error ? { fehler: error.message } : { verbleibend: data.verbleibend };
  }
  const { error } = await supa.from('buchungen').insert({
    raum, tisch: tisch || null, nutzer_id: user.id, name: user.name, start, ende, quelle: 'web',
  });
  return error ? { fehler: error.message } : {};
}

// Gäste löschen über die Sitzung (nur eigene), alle anderen direkt.
// Nicht-Admins nur eigene echte Buchungen (UI-seitig, siehe CLAUDE.md).
async function buchungLoeschen(id, user){
  if(user.gast){
    const { data, error } = await supa.rpc('gast_buchung_loeschen', { p_sitzung: user.sitzung, p_id: id });
    return error ? { fehler: error.message } : { verbleibend: data.verbleibend };
  }
  let q = supa.from('buchungen').delete().eq('id', id);
  if(!user.ist_admin) q = q.eq('nutzer_id', user.id);
  const { error } = await q;
  return error ? { fehler: error.message } : {};
}

// ── Etagen speichern/löschen ──
// Angemeldete Nutzer und Admin: in der DB für alle (Passwort wird in der DB
// geprüft; Nicht-Admins dürfen nur ihre eigenen Etagen ändern/löschen)
async function etageSpeichernDb(adminName, adminPasswort, definition){
  const { data, error } = await supa.rpc('etage_speichern',
    { p_admin_name: adminName, p_admin_passwort: adminPasswort, p_definition: definition });
  return error ? { fehler: error.message } : { id: data };
}
async function etageLoeschenDb(adminName, adminPasswort, id){
  const { error } = await supa.rpc('etage_loeschen',
    { p_admin_name: adminName, p_admin_passwort: adminPasswort, p_id: id });
  return error ? { fehler: error.message } : {};
}
// Gast: nur für die eigene Sitzung
async function gastEtageSpeichern(sitzung, definition){
  const { data, error } = await supa.rpc('gast_etage_speichern', { p_sitzung: sitzung, p_definition: definition });
  return error ? { fehler: error.message } : { id: data.id, verbleibend: data.verbleibend };
}
async function gastEtageLoeschen(sitzung, id){
  const { data, error } = await supa.rpc('gast_etage_loeschen', { p_sitzung: sitzung, p_id: id });
  return error ? { fehler: error.message } : { verbleibend: data.verbleibend };
}

// ── Testsystem zurücksetzen ──
async function gastZuruecksetzen(sitzung){
  const { data, error } = await supa.rpc('gast_zuruecksetzen', { p_sitzung: sitzung });
  return error ? { fehler: error.message } : data;
}
async function testsystemLeeren(adminName, adminPasswort){
  const { data, error } = await supa.rpc('testsystem_leeren', { p_admin_name: adminName, p_admin_passwort: adminPasswort });
  return error ? { fehler: error.message } : data;
}

// ── Profil ──
// Eigene Buchungen ab heute (für die Übersicht im Profil)
async function ladeMeineBuchungen(userId, abDatum){
  const { data, error } = await supa.from('buchungen').select(BUCHUNG_SPALTEN)
    .eq('nutzer_id', userId).eq('test', false).gt('ende', abDatum + ' 00:00').order('start').limit(200);
  return error ? { fehler: error.message, buchungen: [] } : { buchungen: data };
}
// Name und/oder Bild ändern (Passwort wird in der DB geprüft)
async function profilSpeichern(name, passwort, neuerName, bildAendern, bild){
  const { data, error } = await supa.rpc('profil_speichern',
    { p_name: name, p_passwort: passwort, p_neuer_name: neuerName, p_bild_aendern: bildAendern, p_bild: bild });
  return error ? { fehler: error.message } : (data && data[0]) || {};
}
async function passwortAendern(name, alt, neu){
  const { data, error } = await supa.rpc('nutzer_passwort_aendern', { p_name: name, p_altes: alt, p_neues: neu });
  if(error) return { fehler: error.message };
  return data ? {} : { fehler: 'Das aktuelle Passwort ist falsch.' };
}
