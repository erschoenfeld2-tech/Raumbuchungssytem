// ══════════════════════════════════════════════════════════
// Mini-PostgREST für die Browser-Tests (tests/e2e_tests.js)
//
// Übersetzt genau die REST-Aufrufe, die die App über supabase-js macht
// (select/insert/update/delete mit eq/lt/gt/like/in/or/order und rpc),
// in SQL und führt sie per psql als Rolle "anon" gegen die lokale
// Test-Datenbank aus. Dadurch gelten die echten RLS-Policies, Trigger
// und Funktionen aus supabase/migrations/ – nur eben lokal.
// Keine npm-Abhängigkeiten: braucht nur psql im PATH.
// ══════════════════════════════════════════════════════════
const { spawnSync } = require('child_process');

const PG = {
  host: process.env.PGHOST || '/var/tmp/rb-pgtest',
  port: process.env.PGPORT || '54329',
  user: process.env.PGUSER || 'postgres',
  db: process.env.PGDATABASE || 'rbtest',
};

function psql(sql, alsAnon = true){
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
    '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.db],
    { input: (alsAnon ? 'begin; set local role anon;\n' : 'begin;\n') + sql + ';\ncommit;\n', encoding: 'utf8' });
  if(r.status !== 0){
    const msg = (r.stderr || '').replace(/^psql:[^\n]*?ERROR:\s*/m, '').replace(/^ERROR:\s*/m, '').split('\n')[0].trim();
    return { fehler: msg || 'psql-Fehler' };
  }
  return { text: r.stdout.trim() };
}

const lit = v => v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
function ident(n){
  if(!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error('Ungültiger Bezeichner: ' + n);
  return n;
}

// "a,b,(c,d),"x,y"" → oberste Ebene an Kommas trennen (Klammern/Anführungszeichen beachten)
function trennen(s){
  const teile = []; let tiefe = 0, inQ = false, akt = '';
  for(let i = 0; i < s.length; i++){
    const z = s[i];
    if(z === '\\' && inQ){ akt += z + s[++i]; continue; }
    if(z === '"') inQ = !inQ;
    if(!inQ && z === '(') tiefe++;
    if(!inQ && z === ')') tiefe--;
    if(!inQ && tiefe === 0 && z === ','){ teile.push(akt); akt = ''; continue; }
    akt += z;
  }
  if(akt) teile.push(akt);
  return teile;
}
const ohneQuotes = v => /^".*"$/.test(v) ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v;

function bedingung(spalte, ausdruck){
  const m = ausdruck.match(/^(not\.)?(eq|neq|lt|lte|gt|gte|like|ilike|in|is)\.([\s\S]*)$/);
  if(!m) throw new Error('Unbekannter Filter: ' + ausdruck);
  const [, nicht, op, wert] = m;
  const s = ident(spalte);
  let sql;
  const ops = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=', like: 'like', ilike: 'ilike' };
  if(op === 'in') sql = `${s} in (${trennen(wert.replace(/^\(|\)$/g, '')).map(v => lit(ohneQuotes(v))).join(',')})`;
  else if(op === 'is') sql = `${s} is ${({ null: 'null', true: 'true', false: 'false' })[wert] || 'null'}`;
  else sql = `${s} ${ops[op]} ${lit((op === 'like' || op === 'ilike') ? wert.replace(/\*/g, '%') : wert)}`;
  return nicht ? `not (${sql})` : sql;
}
function oderBedingung(wert){
  return '(' + trennen(wert.replace(/^\(|\)$/g, '')).map(t => {
    const i = t.indexOf('.');
    return bedingung(t.slice(0, i), t.slice(i + 1));
  }).join(' or ') + ')';
}
function whereTeil(params){
  const b = [];
  for(const [k, v] of params){
    if(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    b.push(k === 'or' ? oderBedingung(v) : bedingung(k, v));
  }
  return b.length ? ' where ' + b.join(' and ') : '';
}

const rpcInfo = {};
function rpcTyp(fn){
  if(!rpcInfo[fn]){
    const r = psql(`select proretset::int || ':' || prorettype::regtype from pg_proc where proname = ${lit(fn)} limit 1`, false);
    rpcInfo[fn] = r.text || '';
  }
  return rpcInfo[fn];
}

// Hauptfunktion: (method, url, headers, body-Text) → { status, body }
function antwort(method, urlText, headers, bodyText){
  const url = new URL(urlText);
  const pfad = url.pathname.replace(/^\/rest\/v1\//, '');
  const params = [...url.searchParams.entries()];
  const accept = headers['accept'] || '';
  const prefer = headers['prefer'] || '';
  const json = obj => ({ status: 200, body: JSON.stringify(obj) });
  const fehler = (msg, status = 400) => ({ status, body: JSON.stringify({ code: 'P0001', message: msg, details: null, hint: null }) });
  try {
    if(method === 'OPTIONS') return { status: 204, body: '' };
    if(pfad.startsWith('rpc/')){
      const fn = ident(pfad.slice(4));
      const args = bodyText ? JSON.parse(bodyText) : {};
      const argSql = Object.entries(args).map(([k, v]) =>
        `${ident(k)} => ${typeof v === 'object' && v !== null ? lit(JSON.stringify(v)) : lit(v)}`).join(', ');
      const [setof, typ] = rpcTyp(fn).split(':');
      // setof <Tabelle/record> → Objekte; setof <einfacher Typ, z.B. jsonb> → Werte (wie PostgREST)
      const sql = setof === '1' && typ === 'record' ? `select coalesce(json_agg(t), '[]'::json) from ${fn}(${argSql}) t`
        : setof === '1' ? `select coalesce(json_agg(t.x), '[]'::json) from ${fn}(${argSql}) as t(x)`
        : typ === 'void' ? `select ${fn}(${argSql}); select 'null'` : `select to_json(${fn}(${argSql}))`;
      const r = psql(sql);
      if(r.fehler) return fehler(r.fehler);
      return { status: 200, body: r.text.split('\n').pop() || 'null' };
    }
    const tabelle = ident(pfad);
    if(method === 'GET'){
      const sel = (url.searchParams.get('select') || '*').split(',').map(c => c === '*' ? '*' : ident(c.trim())).join(',');
      let sql = `select ${sel} from ${tabelle}${whereTeil(params)}`;
      const order = url.searchParams.get('order');
      if(order) sql += ' order by ' + order.split(',').map(o => { const [c, r] = o.split('.'); return ident(c) + (r === 'desc' ? ' desc' : ' asc'); }).join(',');
      if(url.searchParams.get('limit')) sql += ' limit ' + parseInt(url.searchParams.get('limit'), 10);
      const r = psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`);
      if(r.fehler) return fehler(r.fehler);
      const zeilen = JSON.parse(r.text);
      if(accept.includes('vnd.pgrst.object')){
        if(zeilen.length !== 1) return fehler('JSON object requested, multiple (or no) rows returned', 406);
        return json(zeilen[0]);
      }
      return json(zeilen);
    }
    if(method === 'POST'){
      const daten = JSON.parse(bodyText);
      const zeilen = Array.isArray(daten) ? daten : [daten];
      const spalten = [...new Set(zeilen.flatMap(Object.keys))].map(ident);
      const werte = zeilen.map(z => '(' + spalten.map(s => z[s] === undefined ? 'default' : (typeof z[s] === 'boolean' ? String(z[s]) : lit(z[s]))).join(',') + ')').join(',');
      // Wie PostgREST: nur bei return=representation zurücklesen, und nur die
      // per ?select= gewünschten Spalten (Spaltenrechte gelten auch hier)
      const zurueck = prefer.includes('return=representation');
      const sel = (url.searchParams.get('select') || '*').split(',').map(c => c === '*' ? '*' : ident(c.trim())).join(',');
      const r = zurueck
        ? psql(`with neu as (insert into ${tabelle} (${spalten.join(',')}) values ${werte} returning ${sel}) select coalesce(json_agg(neu), '[]'::json) from neu`)
        : psql(`insert into ${tabelle} (${spalten.join(',')}) values ${werte}`);
      if(r.fehler) return fehler(r.fehler);
      return zurueck ? { status: 201, body: r.text } : { status: 201, body: '' };
    }
    if(method === 'PATCH'){
      const daten = JSON.parse(bodyText);
      const set = Object.entries(daten).map(([k, v]) => `${ident(k)} = ${typeof v === 'boolean' ? v : lit(v)}`).join(', ');
      const r = psql(`update ${tabelle} set ${set}${whereTeil(params)}`);
      if(r.fehler) return fehler(r.fehler);
      return { status: 204, body: '' };
    }
    if(method === 'DELETE'){
      const r = psql(`delete from ${tabelle}${whereTeil(params)}`);
      if(r.fehler) return fehler(r.fehler);
      return { status: 204, body: '' };
    }
    return fehler('Methode nicht unterstützt: ' + method, 405);
  } catch(e){
    return fehler(e.message);
  }
}

module.exports = { antwort, psql };
