// ══════════════════════════════════════════════════════════
// VORLAGE für eine neue Etage (oder ein neues Gebäude)
//
// So fügst du eine Etage per Datei hinzu:
//   1. Diese Datei kopieren, z.B. nach etagen/werkstatt-etage-1.js
//   2. Werte unten anpassen (id, gebaeude, nr, raeume …)
//   3. In index.html im Block "ETAGEN" eine Zeile ergänzen:
//        <script src="etagen/werkstatt-etage-1.js"></script>
//   4. Seite neu laden – die Etage erscheint als eigener Tab
//      (ein neuer gebaeude-Name erscheint als eigener Gebäude-Tab).
//   Prüfen: node tests/etagen_pruefen.js  (meldet Fehler wie doppelte Raumnamen)
//
// Ohne Programmieren geht es auch im Browser: als Admin anmelden →
// "＋ Etage / Gebäude" → Grundriss-Bild hochladen, Räume aufziehen →
// in der Datenbank speichern oder als Datei (.js/.json) exportieren.
//
// Koordinaten: SVG-Pixel, Ursprung oben links, Fläche breite × hoehe.
// Diese Vorlage selbst ist NICHT in index.html eingebunden.
// ══════════════════════════════════════════════════════════
registriereEtage({
  id: 'neues-gebaeude-1',     // eindeutig, nur a–z, 0–9 und Bindestrich
  gebaeude: 'Neues Gebäude',  // gleicher Name = gleicher Gebäude-Tab
  kuerzel: '',                // optional: Präfix für Tischcodes, z.B. 'W' → W-1.101
  nr: 1,                      // Etagennummer = erste Ziffer der Tischcodes
  name: 'Etage 1',            // Beschriftung des Tabs
  breite: 960, hoehe: 480,    // Zeichenfläche

  // optional: Grundriss als Bild darunterlegen (Datei im Repo oder data:image/...).
  // Mit Bild werden Räume als halbtransparente Flächen darüber gezeichnet,
  // ohne Bild zeichnet das System Wände, Möbel und Fenster selbst.
  // hintergrund: 'etagen/bilder/neues-gebaeude-1.png',

  aussenwand: {x:20, y:20, w:920, h:440},           // optional, mit Fenstern
  flure: [{x:20, y:190, w:920, h:80, name:'Flur'}],  // optional

  // Buchbare Räume. Namen müssen im GESAMTEN System eindeutig sein.
  //   typ 'meeting'   = ganzer Raum ist eine Buchung (Kapazität 1)
  //   typ 'sharedesk' = einzeln buchbare Tische (tische: 1–20)
  //   nr              = Raum-Nr. für Tischcodes – später nicht mehr ändern
  //   nfc: true       = Raum hat einen NFC-Reader (Testsystem: nur per Karte buchbar;
  //                     Reader zusätzlich in nfc_bridge_config.py eintragen)
  //   sub / sitze / stirn (nur meeting): Untertitel, Stühle je Längsseite, Stühle an den Stirnseiten (0/1)
  raeume: [
    {name:'Neuer Meetingraum', nr:1, typ:'meeting',   x:20,  y:20, w:300, h:170, sub:'10 Plätze', sitze:4, stirn:1},
    {name:'Neuer ShareDesk',   nr:2, typ:'sharedesk', x:320, y:20, w:300, h:170, tische:4},
  ],

  // Nicht buchbare Flächen (nur Deko): treppe, wc, lounge, kueche, technik, sonstiges
  bereiche: [
    {typ:'treppe', name:'Treppe', x:820, y:20, w:120, h:170},
  ],

  // Türen: o 'h' = in waagerechter Wand, 'v' = in senkrechter Wand; len = Breite;
  // s = Aufschlagrichtung (1 / -1)
  tueren: [
    {o:'h', x:150, y:190, len:32, s:-1},
  ],

  // Freie Beschriftungen
  texte: [{x:70, y:234, t:'Eingang'}],
});
