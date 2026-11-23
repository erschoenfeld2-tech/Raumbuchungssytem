// ══════════════════════════════════════════════════════════
// Hintergrund-Effekte: Cursor-Spotlight (überall) und animiertes
// Netz (nur im Login-Bildschirm, in der App abgeschaltet).
// ══════════════════════════════════════════════════════════

let netCv = null, netAktiv = true, netLaeuft = false, netPunkte = [];
const netReduziert = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function netzAn(an){
  netAktiv = an;
  if(!netCv) return;
  netCv.style.display = an ? 'block' : 'none';
  if(an && !netLaeuft) netZeichnen();
}
function netGroesse(){
  netCv.width = innerWidth; netCv.height = innerHeight;
  const n = Math.min(70, Math.round(innerWidth * innerHeight / 22000));
  netPunkte = Array.from({length: n}, () => ({ x: Math.random()*netCv.width, y: Math.random()*netCv.height,
    vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35 }));
}
function netZeichnen(){
  if(!netAktiv || document.hidden){ netLaeuft = false; return; }
  netLaeuft = true;
  const c = netCv.getContext('2d');
  c.clearRect(0, 0, netCv.width, netCv.height);
  for(const p of netPunkte){
    if(!netReduziert){ p.x += p.vx; p.y += p.vy; }
    if(p.x < 0 || p.x > netCv.width) p.vx *= -1;
    if(p.y < 0 || p.y > netCv.height) p.vy *= -1;
  }
  for(let i = 0; i < netPunkte.length; i++){
    const a = netPunkte[i];
    c.fillStyle = 'rgba(124,138,247,.7)';
    c.beginPath(); c.arc(a.x, a.y, 1.8, 0, 6.3); c.fill();
    for(let j = i + 1; j < netPunkte.length; j++){
      const b = netPunkte[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if(d < 140){
        c.strokeStyle = `rgba(79,110,247,${.28 * (1 - d/140)})`;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
    }
  }
  requestAnimationFrame(netZeichnen);
}
function netzStart(){
  netCv = document.getElementById('net');
  document.addEventListener('pointermove', e => {
    document.body.style.setProperty('--mx', e.clientX + 'px');
    document.body.style.setProperty('--my', e.clientY + 'px');
  });
  addEventListener('resize', netGroesse);
  // im Hintergrund-Tab pausieren, beim Zurückkehren weiterlaufen lassen
  document.addEventListener('visibilitychange', () => { if(!document.hidden && netAktiv && !netLaeuft) netZeichnen(); });
  netGroesse();
  netzAn(netAktiv);
}
