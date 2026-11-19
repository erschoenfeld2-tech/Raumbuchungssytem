// ══════════════════════════════════════════════════════════
// Hauptgebäude · Etage 2
// Eine Etage = eine Datei. Aufbau und alle Felder: siehe etagen/_vorlage-etage.js
// Raum-Nummern (nr) NICHT ändern – sie stecken in den Tischcodes bereits
// gespeicherter Buchungen (z.B. ShareDesk 6 → Tische 2.101 / 2.102).
// ══════════════════════════════════════════════════════════
registriereEtage({
  id: 'hauptgebaeude-2',
  gebaeude: 'Hauptgebäude',
  nr: 2,
  name: 'Etage 2',
  breite: 960, hoehe: 480,
  aussenwand: {x:20, y:20, w:920, h:440},
  flure: [{x:20, y:190, w:920, h:80, name:'Flur'}],

  raeume: [
    {name:'ShareDesk 6',  nr:1, typ:'sharedesk', tische:2, x:20,  y:20,  w:230, h:170},
    {name:'ShareDesk 7',  nr:2, typ:'sharedesk', tische:2, x:420, y:20,  w:230, h:170},
    {name:'ShareDesk 8',  nr:3, typ:'sharedesk', tische:2, x:650, y:20,  w:170, h:170},
    {name:'ShareDesk 9',  nr:4, typ:'sharedesk', tische:2, x:20,  y:270, w:270, h:190},
    {name:'ShareDesk 10', nr:5, typ:'sharedesk', tische:2, x:530, y:270, w:290, h:190},
  ],

  bereiche: [
    {typ:'kueche', name:'Teeküche', x:250, y:20,  w:170, h:170},
    {typ:'treppe', name:'Treppe',   x:820, y:20,  w:120, h:170},
    {typ:'lounge', name:'Lounge',   x:290, y:270, w:240, h:190},
    {typ:'wc',     name:'WC',       x:820, y:270, w:120, h:190},
  ],

  tueren: [
    {o:'h', x:110, y:190, len:32, s:-1}, {o:'h', x:315, y:190, len:32, s:-1}, {o:'h', x:520, y:190, len:32, s:-1},
    {o:'h', x:715, y:190, len:32, s:-1}, {o:'h', x:865, y:190, len:32, s:-1},
    {o:'h', x:130, y:270, len:32, s:1},  {o:'h', x:380, y:270, len:40, s:1},  {o:'h', x:640, y:270, len:32, s:1},
    {o:'h', x:865, y:270, len:32, s:1},
  ],
});
