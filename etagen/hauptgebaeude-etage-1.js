// ══════════════════════════════════════════════════════════
// Hauptgebäude · Etage 1
// Eine Etage = eine Datei. Aufbau und alle Felder: siehe etagen/_vorlage-etage.js
// Raum-Nummern (nr) NICHT ändern – sie stecken in den Tischcodes bereits
// gespeicherter Buchungen (z.B. ShareDesk 1 → Tische 1.301 / 1.302).
// ══════════════════════════════════════════════════════════
registriereEtage({
  id: 'hauptgebaeude-1',
  gebaeude: 'Hauptgebäude',
  nr: 1,
  name: 'Etage 1',
  breite: 960, hoehe: 480,
  aussenwand: {x:20, y:20, w:920, h:440},
  flure: [{x:20, y:190, w:920, h:80, name:'Flur'}],

  raeume: [
    {name:'Besprechungsraum', nr:1, typ:'meeting',   nfc:true, x:170, y:20,  w:230, h:170, sub:'8 Plätze',  sitze:4, stirn:0},
    {name:'Konferenzraum',    nr:2, typ:'meeting',   nfc:true, x:400, y:20,  w:300, h:170, sub:'12 Plätze', sitze:5, stirn:1},
    {name:'ShareDesk 1',      nr:3, typ:'sharedesk', tische:2, x:20,  y:20,  w:150, h:170},
    {name:'ShareDesk 2',      nr:4, typ:'sharedesk', tische:2, x:700, y:20,  w:120, h:170},
    {name:'ShareDesk 3',      nr:5, typ:'sharedesk', tische:2, x:20,  y:270, w:170, h:190},
    {name:'ShareDesk 4',      nr:6, typ:'sharedesk', tische:2, x:190, y:270, w:170, h:190},
    {name:'ShareDesk 5',      nr:7, typ:'sharedesk', tische:2, x:360, y:270, w:170, h:190},
  ],

  bereiche: [
    {typ:'treppe',  name:'Treppe',  x:820, y:20,  w:120, h:170},
    {typ:'lounge',  name:'Lounge',  x:530, y:270, w:170, h:190},
    {typ:'technik', name:'Technik', x:700, y:270, w:120, h:190},
    {typ:'wc',      name:'WC',      x:820, y:270, w:120, h:190},
  ],

  // Türen schlagen in den Flur auf (s: 1 = nach unten, -1 = nach oben), damit
  // Türbögen keine Möbel oder Beschriftungen in den Räumen überdecken
  tueren: [
    {o:'h', x:110, y:190, len:32, s:1},  {o:'h', x:250, y:190, len:32, s:1},  {o:'h', x:520, y:190, len:32, s:1},
    {o:'h', x:745, y:190, len:32, s:1},  {o:'h', x:865, y:190, len:32, s:1},
    {o:'h', x:70,  y:270, len:32, s:-1}, {o:'h', x:240, y:270, len:32, s:-1}, {o:'h', x:410, y:270, len:32, s:-1},
    {o:'h', x:575, y:270, len:40, s:-1}, {o:'h', x:740, y:270, len:32, s:-1}, {o:'h', x:865, y:270, len:32, s:-1},
    {o:'v', x:20,  y:215, len:40, s:1},
  ],
  texte: [{x:70, y:234, t:'Eingang'}],
});
