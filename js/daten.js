// ══════════════════════════════════════════════════════════
// Datenzugriff (Supabase / PostgREST). Alle Lese-/Schreibzugriffe der
// App laufen über diese Datei.
// Testsystem (Gast): Buchungen tragen test = true und sind strikt vom
// Echtbetrieb getrennt (siehe Migration 20261119120000_gast_testsystem.sql).
// ══════════════════════════════════════════════════════════

// Nutzernamen werden bewusst separat geladen und im Browser zugeordnet statt
// über eine eingebettete Relation (nutzer:nutzer_id(name)) – das bräuchte eine
// im Schema-Cache erkannte Fremdschlüssel-Beziehung. Immer über die View
// nutzer_public, nie über die Tabelle nutzer (nfc_uid bleibt geschützt).
let nutzerMap = {};
async function ladeNutzerMap(){
  const { data, error } = await supa.from('nutzer_public').select('id,name');
  if(error){ console.error(error); return; }
  nutzerMap = {};
  data.forEach(n => nutzerMap[n.id] = n.name);
}

// Etagen aus der Datenbank (angelegt über den Etagen-Editor). Fehlt die
// Tabelle noch (Migration nicht deployt), läuft die App mit den Datei-Etagen weiter.
async function ladeDbEtagen(){
  if(!supa) return [];
  const { data, error } = await supa.from('etagen').select('id,definition').order('id');
  if(error){ console.warn('[Etagen] Datenbank-Etagen nicht geladen:', error.message); return []; }
  return data.map(z => z.definition);
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

// Alle Buchungen eines Tages (Echtbetrieb oder Testsystem)
async function ladeBuchungen(datum, gast){
  if(gast) await testBuchungenAufraeumen();
  let q = supa.from('buchungen').select('*').like('start', datum + '%');
  // Echtbetrieb: nur echte Buchungen. Testsystem: Test-Buchungen + die per
  // NFC gebuchten Räume, damit man deren Belegung auch dort sieht.
  if(gast){
    const nfc = nfcRaumNamen();
    q = nfc.length ? q.or(`test.eq.true,${raumInFilter(nfc)}`) : q.eq('test', true);
  } else {
    q = q.eq('test', false);
  }
  const { data, error } = await q.order('start');
  if(error) return { fehler: error.message, buchungen: [] };
  return { buchungen: data.map(b => ({ ...b, name: nutzerMap[b.nutzer_id] || b.name || '?' })) };
}

// Kapazitätsprüfung direkt gegen die Datenbank (aktueller Stand, nicht der
// zuletzt geladene) – Logik in kapazitaetPruefen() (js/belegung.js).
async function pruefeKapazitaet(raumName, start, ende, tisch, gast){
  const raum = raumByName(raumName);
  if(!raum) return { ok:false, msg:`Raum "${raumName}" ist unbekannt` };
  const { data, error } = await supa.from('buchungen')
    .select('id,raum,tisch,start,ende')
    .eq('raum', raumName)
    .eq('test', !!gast)
    .lt('start', ende)
    .gt('ende', start);
  if(error) return { ok:false, msg:'Fehler bei Kapazitätsprüfung: ' + error.message };
  return kapazitaetPruefen(raum, data, start, ende, tisch);
}

async function buchungAnlegen(user, raum, tisch, start, ende){
  const { error } = await supa.from('buchungen').insert({
    raum, tisch: tisch || null, nutzer_id: user.id, name: user.name,
    start, ende, quelle: 'web', test: !!user.gast,
  });
  return error ? error.message : null;
}

async function buchungLoeschen(id, user){
  let q = supa.from('buchungen').delete().eq('id', id);
  if(!user.ist_admin) q = q.eq('nutzer_id', user.id);   // nur eigene (UI-seitig, siehe CLAUDE.md)
  const { error } = await q;
  return error ? error.message : null;
}

// ── Etagen speichern/löschen (nur Admin; Passwort wird in der DB geprüft) ──
async function etageSpeichernDb(adminName, adminPasswort, definition){
  const { data, error } = await supa.rpc('etage_speichern',
    { p_admin_name: adminName, p_admin_passwort: adminPasswort, p_definition: definition });
  return error ? { fehler: error.message } : { id: data };
}
async function etageLoeschenDb(adminName, adminPasswort, id){
  const { error } = await supa.rpc('etage_loeschen',
    { p_admin_name: adminName, p_admin_passwort: adminPasswort, p_id: id });
  return error ? error.message : null;
}
