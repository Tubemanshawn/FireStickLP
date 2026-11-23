// ===== Retro TV mini window =====
// Scroll = volume, click = OK, right-click = Back,
// drag = move, double-click or ✕ = close. Video only (sound stays in the
// main window, so it isn't heard twice).
const video = document.getElementById('video');
const osd = document.getElementById('osd');
let osdT = null;
function showOsd(t, ms = 900) {
  osd.textContent = t; osd.classList.add('show');
  clearTimeout(osdT); if (ms) osdT = setTimeout(() => osd.classList.remove('show'), ms);
}

// ---- Capture card (same one the main window uses) ----
(async () => {
  const cam = new URLSearchParams(location.search).get('cam');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: cam ? { exact: cam } : undefined,
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
  } catch (e) { showOsd('NO SIGNAL', 0); }
})();

// ---- Scroll = volume ----
// The sound plays in the main window, so the scroll goes there and the main
// window sends back the new level to show here.
document.addEventListener('wheel', (e) => {
  e.preventDefault();
  window.fire.pipVol(e.deltaY < 0 ? 5 : -5);
}, { passive: false });
window.fire.onVolShow((text) => showOsd(text));

// ---- Click = OK, drag = move ----
const DRAG_PX = 5;
let down = null, dragging = false;
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.id === 'x') return;
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
  document.body.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', (e) => {
  if (!down) return;
  const dx = e.screenX - down.x, dy = e.screenY - down.y;
  if (!dragging && Math.hypot(dx, dy) < DRAG_PX) return;
  dragging = true;
  window.fire.pipMove(dx, dy);
  down = { x: e.screenX, y: e.screenY };
});
let clickT = null;
document.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !down) return;
  const wasDrag = dragging;
  down = null; dragging = false;
  if (wasDrag) return;
  // Wait a moment so a double-click (close) doesn't also press OK.
  clearTimeout(clickT);
  clickT = setTimeout(() => { window.fire.key('ok'); showOsd('OK'); }, 250);
});
document.addEventListener('dblclick', () => { clearTimeout(clickT); window.fire.pipClose(); });

// ---- Right-click = Back ----
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.fire.key('back'); showOsd('BACK');
});

// ---- Same skin + effects as the main window ----
function applyLook(look) {
  if (!look) return;
  const b = document.body;
  b.className = 'skin-' + (look.skin || 'plain') + (look.fx || []).map((f) => ' fx-' + f).join('') +
    (look.up ? '' : ' fire-down');
}
window.fire.lookGet().then(applyLook);
window.fire.onLook(applyLook);

document.getElementById('x').onclick = () => window.fire.pipClose();
