// Page logic and the one requestAnimationFrame loop. js/sky.js (three.js) hooks in
// through window.__sky when it loads; if it never does, everything here still works.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const root = document.documentElement;
const $ = id => document.getElementById(id);

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const range = (v, a, b) => clamp01((v - a) / (b - a));
// frame-rate independent lerp: `k` is the per-frame factor at 60 fps
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.pow(1 - k, dt * 60));

// shared with sky.js
const state = { progress: 0, launchT: -1, clutter: 1, mouseX: 0, mouseY: 0, dt: 1 / 60 };

const maxScroll = () => Math.max(0, root.scrollHeight - innerHeight);

/* ---------- inertia scrolling ----------
   Moves the real scroll position, so sticky, anchors and the scrollbar keep working. */
const smooth = { on: finePointer && !reduceMotion, target: 0, current: 0, lastSet: -1, running: false };

function smoothStep() {
  const diff = smooth.target - smooth.current;
  if (Math.abs(diff) < 0.4) { smooth.current = smooth.target; smooth.running = false; }
  else smooth.current += diff * 0.09;
  smooth.lastSet = Math.round(smooth.current);
  scrollTo(0, smooth.current);
  if (smooth.running) requestAnimationFrame(smoothStep);
}

function scrollToY(y) {
  y = Math.min(maxScroll(), Math.max(0, y));
  if (!smooth.on) return scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  smooth.target = y;
  if (!smooth.running) { smooth.running = true; requestAnimationFrame(smoothStep); }
}

if (smooth.on) {
  smooth.target = smooth.current = scrollY;
  addEventListener('wheel', e => {
    if (e.ctrlKey) return; // pinch zoom
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? innerHeight : 1;
    scrollToY(smooth.target + e.deltaY * unit);
  }, { passive: false });
  // keyboard, scrollbar drags and find-in-page move the page without us: resync
  addEventListener('scroll', () => {
    if (Math.abs(scrollY - smooth.lastSet) > 2) smooth.target = smooth.current = scrollY;
  }, { passive: true });
}

const sectionY = el => el.getBoundingClientRect().top + scrollY - 10;

document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const el = document.querySelector(a.getAttribute('href'));
  if (!el) return;
  e.preventDefault();
  scrollToY(sectionY(el));
  history.replaceState(null, '', a.getAttribute('href'));
}));

/* ---------- cursor: exact dot + reticle that locks onto links and buttons ---------- */
if (finePointer) {
  const dot = $('cursor-dot'), ret = $('reticle');
  const R = { x: 0, y: 0, w: 26, h: 26 }, T = { ...R };
  let locked = null, last = performance.now();

  addEventListener('pointermove', e => {
    dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    document.body.classList.add('cursor-on');
    if (!locked) Object.assign(T, { x: e.clientX, y: e.clientY, w: 26, h: 26 });
  });
  document.addEventListener('pointerover', e => {
    const hit = e.target.closest('a, button');
    if (hit) { locked = hit; ret.classList.add('locked'); }
  });
  document.addEventListener('pointerout', e => {
    if (locked && !e.relatedTarget?.closest?.('a, button')) { locked = null; ret.classList.remove('locked'); }
  });
  document.addEventListener('pointerleave', () => document.body.classList.remove('cursor-on'));

  (function reticle(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    if (locked) { // re-read each frame: the target may scroll or move
      const b = locked.getBoundingClientRect();
      Object.assign(T, { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width + 16, h: b.height + 16 });
    }
    R.x = damp(R.x, T.x, 0.34, dt); R.y = damp(R.y, T.y, 0.34, dt);
    R.w = damp(R.w, T.w, 0.28, dt); R.h = damp(R.h, T.h, 0.28, dt);
    ret.style.width = R.w + 'px';
    ret.style.height = R.h + 'px';
    ret.style.transform = `translate(${R.x - R.w / 2}px, ${R.y - R.h / 2}px)`;
    requestAnimationFrame(reticle);
  })(last);
}

addEventListener('pointermove', e => {
  state.mouseX = (e.clientX / innerWidth) * 2 - 1;
  state.mouseY = (e.clientY / innerHeight) * 2 - 1;
}, { passive: true });

/* ---------- hero: letters assemble, a satellite orbits the name ---------- */
const heroInner = $('hero-inner'), heroName = $('hero-name');
[...heroName.dataset.text].forEach((c, i) => {
  const s = document.createElement('span');
  s.className = c === ' ' ? 'sp' : 'ch';
  s.textContent = c;
  s.setAttribute('aria-hidden', 'true');
  s.style.transitionDelay = (i * 0.045).toFixed(3) + 's';
  heroName.append(s);
});

const nameWrap = $('hero-name-wrap'), nameSat = $('name-sat');
function orbitSatellite(t) {
  const w = nameWrap.offsetWidth, h = nameWrap.offsetHeight;
  if (!w) return;
  const a = t * 0.5, depth = (Math.cos(a) + 1) / 2; // 1 = nearest the viewer
  const x = w / 2 + Math.sin(a) * w * 0.56, y = h / 2 + Math.cos(a) * h * 0.62;
  nameSat.style.transform = `translate(${x}px, ${y}px) scale(${(0.65 + depth * 0.5).toFixed(3)}) rotate(${(Math.sin(a) * 16).toFixed(1)}deg)`;
  nameSat.style.zIndex = depth > 0.5 ? 3 : 1; // behind the letters on the far side
  nameSat.style.filter = `brightness(${(0.55 + depth * 0.45).toFixed(2)})`;
}

/* ---------- about: porthole tilts toward the pointer ---------- */
if (finePointer) {
  const wrap = $('porthole-wrap'), port = $('porthole');
  wrap.addEventListener('pointermove', e => {
    const r = wrap.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    port.style.transform = `rotateX(${(-py * 13).toFixed(2)}deg) rotateY(${(px * 13).toFixed(2)}deg)`;
  });
  wrap.addEventListener('pointerleave', () => { port.style.transform = ''; });
}

/* ---------- reveal on scroll ----------
   A per-frame sweep instead of IntersectionObserver: a fast scroll can carry an element
   from below the viewport to above it between two observer checks, and it never shows. */
let pending = [...document.querySelectorAll('.reveal')];
function sweepReveals() {
  if (!pending.length) return;
  const line = innerHeight * 0.88;
  pending = pending.filter(el => {
    if (el.getBoundingClientRect().top > line) return true;
    el.classList.add('show');
    return false;
  });
}

/* ---------- research: a looping signal trace per row ----------
   Seeded noise (stable across reloads), drawn twice end to end so a -50% slide never seams. */
document.querySelectorAll('.dsn-wave').forEach((wave, i) => {
  let seed = (i + 1) * 7919;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const vals = [];
  for (let x = 0; x < 100; x += 2) vals.push(11 + (rand() - 0.5) * 17 * (rand() > 0.86 ? 1 : 0.28));
  const pts = [0, 1].flatMap(c => vals.map((v, k) => `${c * 100 + k * 2},${v.toFixed(1)}`));
  pts.push(`200,${vals[0].toFixed(1)}`);
  wave.innerHTML = `<svg viewBox="0 0 200 22" preserveAspectRatio="none"><polyline points="${pts.join(' ')}"/></svg>`;
});

/* ---------- experience: roles on real constellations ---------- */
const JOBS = [
  { org: 'Diebold Nixdorf', role: 'R&D GenAI Intern, Mumbai', when: 'Sep 2025 to Jan 2026' },
  { org: 'Google Developer Groups, Nashik', role: 'AI/ML Lead, workshops for 300+ students', when: 'Sep 2024 to Jul 2025' },
  { org: 'MET Enthusia 2026', role: 'Title Winner, for the Convo-Ease system', when: '2026' },
  { org: 'ICSSCC 2026', role: 'Presented the Convo-Ease paper', when: '2026' }
];

// [right ascension in hours, declination in degrees] of the real stars (J2000).
// `jobs` picks the stars that carry a role, in JOBS order; the rest are faint companions.
const FORMATIONS = [
  { name: 'Orion', // Betelgeuse, Bellatrix, Mintaka, Alnilam, Alnitak, Saiph, Rigel, Meissa
    stars: [[5.919, 7.41], [5.419, 6.35], [5.533, -0.3], [5.604, -1.2], [5.679, -1.94], [5.796, -9.67], [5.242, -8.2], [5.585, 9.93]],
    lines: [[7, 0], [7, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6]], jobs: [0, 1, 5, 6] },
  { name: 'Cassiopeia', // Caph, Schedar, Navi, Ruchbah, Segin
    stars: [[0.153, 59.15], [0.675, 56.54], [0.945, 60.72], [1.43, 60.24], [1.907, 63.67]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]], jobs: [0, 1, 3, 4] },
  { name: 'Ursa Major', // Dubhe, Merak, Phecda, Megrez, Alioth, Mizar, Alkaid
    stars: [[11.062, 61.75], [11.031, 56.38], [11.897, 53.69], [12.257, 57.03], [12.9, 55.96], [13.399, 54.93], [13.792, 49.31]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]], jobs: [0, 2, 4, 6] },
  { name: 'Cygnus', // Deneb, Sadr, Gienah, delta Cygni, Albireo
    stars: [[20.69, 45.28], [20.37, 40.26], [20.77, 33.97], [19.75, 45.13], [19.512, 27.96]],
    lines: [[0, 1], [3, 1], [1, 2], [1, 4]], jobs: [0, 3, 2, 4] },
  { name: 'Leo', // Regulus, eta, Algieba, Adhafera, mu, epsilon, Zosma, Denebola, Chertan
    stars: [[10.14, 11.97], [10.122, 16.76], [10.333, 19.84], [10.278, 23.42], [9.879, 26.01], [9.764, 23.77], [11.235, 20.52], [11.818, 14.57], [11.237, 15.43]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7], [7, 8], [8, 0], [6, 8]], jobs: [0, 5, 6, 7] }
];

// RA/Dec to flat sky coordinates in degrees, centred on the pattern; north up, east left
// as seen from Earth. setFormation() scales these into the stage.
for (const f of FORMATIONS) {
  const dec0 = f.stars.reduce((s, p) => s + p[1], 0) / f.stars.length, cos0 = Math.cos(dec0 * Math.PI / 180);
  const raw = f.stars.map(([ra, dec]) => [-ra * 15 * cos0, -dec]);
  const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  f.xy = raw.map(([x, y]) => [x - cx, y - cy]);
  f.dx = Math.max(...xs) - Math.min(...xs) || 1;
  f.dy = Math.max(...ys) - Math.min(...ys) || 1;
}

const constStage = $('const-stage'), SVGNS = 'http://www.w3.org/2000/svg';
const gLines = $('const-lines'), gTies = $('const-ties'), gMinor = $('const-minor');
let formIndex = 0, constBox = null;
const pos = JOBS.map(() => ({ x: 0, y: 0, tx: 0, ty: 0 }));
const labelOff = JOBS.map(() => ({ dx: 16, dy: -20, w: 0, h: 0 }));

const stars = JOBS.map((job, i) => {
  const el = document.createElement('div');
  el.className = 'star';
  el.innerHTML = '<button class="star-hit"></button><span class="star-dot"></span>' +
    '<span class="star-label"><span class="star-org"></span><span class="star-role"></span><span class="star-when"></span></span>';
  el.querySelector('.star-org').textContent = job.org;
  el.querySelector('.star-role').textContent = job.role;
  el.querySelector('.star-when').textContent = job.when;
  const hit = el.querySelector('.star-hit');
  hit.setAttribute('aria-label', `${job.org}, ${job.role}, ${job.when}`);
  const on = () => stars.forEach((s, n) => s.classList.toggle('on', n === i));
  hit.addEventListener('pointerenter', on);
  hit.addEventListener('focus', on);
  constStage.append(el);
  return el;
});

const dots = FORMATIONS.map((f, i) => {
  const b = document.createElement('button');
  b.setAttribute('aria-label', f.name);
  b.addEventListener('click', () => setFormation(i));
  $('const-dots').append(b);
  return b;
});

// the stage minus room for labels at the sides
function fitBox() {
  const r = constStage.getBoundingClientRect();
  const padX = Math.min(170, r.width * 0.17), padY = Math.min(70, r.height * 0.1);
  return { x: padX, y: padY, w: Math.max(60, r.width - padX * 2), h: Math.max(60, r.height - padY * 2), sw: r.width, sh: r.height };
}

// Greedy label placement: beside the star (outer side first), then nudged up/down, then
// above/below; take the first spot inside the stage that overlaps nothing placed so far.
function placeLabels(box) {
  const placed = [];
  const order = stars.map((_, i) => i).sort((a, b) => pos[a].ty - pos[b].ty);
  for (const i of order) {
    const el = stars[i].querySelector('.star-label');
    const lw = el.offsetWidth, lh = el.offsetHeight, sx = pos[i].tx, sy = pos[i].ty, gap = 16;
    const sides = sx > box.sw / 2 ? ['left', 'right'] : ['right', 'left'];
    const cands = [];
    for (const side of sides)
      for (const k of [0, -0.6, 0.6, -1.2, 1.2, -1.8, 1.8, -2.5, 2.5])
        cands.push({ side, x: side === 'right' ? sx + gap : sx - gap - lw, y: sy - lh / 2 + k * lh });
    for (const k of [0, -0.3, 0.3]) {
      cands.push({ side: 'right', x: sx - lw / 2 + k * lw, y: sy - lh - 20 });
      cands.push({ side: 'right', x: sx - lw / 2 + k * lw, y: sy + 20 });
    }
    const overlap = c => placed.reduce((sum, p) => {
      const ox = Math.min(c.x + lw, p.x + p.w) - Math.max(c.x, p.x);
      const oy = Math.min(c.y + lh, p.y + p.h) - Math.max(c.y, p.y);
      return sum + (ox > 0 && oy > 0 ? ox * oy : 0);
    }, 0);
    let best = null, bestScore = Infinity;
    for (const c of cands) {
      if (c.x < 2 || c.y < 2 || c.x + lw > box.sw - 2 || c.y + lh > box.sh - 2) continue;
      const score = overlap(c);
      if (score < bestScore) { best = c; bestScore = score; }
      if (score === 0) break;
    }
    if (!best) best = { ...cands[0], x: Math.max(2, Math.min(cands[0].x, box.sw - lw - 2)), y: Math.max(2, Math.min(cands[0].y, box.sh - lh - 2)) };
    placed.push({ x: best.x, y: best.y, w: lw, h: lh });
    stars[i].dataset.side = best.side;
    el.style.setProperty('--lx', (best.x - sx).toFixed(1) + 'px');
    el.style.setProperty('--ly', (best.y - sy).toFixed(1) + 'px');
    labelOff[i] = { dx: best.x - sx, dy: best.y - sy, w: lw, h: lh };
  }
}

const svgEl = cls => { const e = document.createElementNS(SVGNS, cls === 'const-minor' ? 'circle' : 'line'); e.setAttribute('class', cls); return e; };

function setFormation(i) {
  formIndex = (i + FORMATIONS.length) % FORMATIONS.length;
  const f = FORMATIONS[formIndex], box = (constBox = fitBox());
  $('const-name').textContent = f.name;
  $('const-sub').textContent = `${formIndex + 1} of ${FORMATIONS.length}`;
  dots.forEach((d, n) => d.setAttribute('aria-current', String(n === formIndex)));
  // fill the box, but never stretch one axis more than 1.6x the other, so the shape stays recognisable
  let sx = box.w / f.dx, sy = box.h / f.dy;
  sx = Math.min(sx, sy * 1.6); sy = Math.min(sy, sx * 1.6);
  f.px = f.xy.map(([x, y]) => [box.x + box.w / 2 + x * sx, box.y + box.h / 2 + y * sy]);
  f.jobs.forEach((si, n) => { [pos[n].tx, pos[n].ty] = f.px[si]; });
  gMinor.replaceChildren(...f.px.flatMap(([x, y], si) => {
    if (f.jobs.includes(si)) return [];
    const c = svgEl('const-minor');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 2.6);
    return [c];
  }));
  gTies.replaceChildren(...JOBS.map(() => svgEl('const-tie')));
  gLines.replaceChildren(...f.lines.map(() => svgEl('const-line')));
  placeLabels(box);
}

const setLine = (l, a, b) => { l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]); l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]); };

function renderConstellation(dt) {
  if (!constBox || !constStage.offsetWidth) return;
  const f = FORMATIONS[formIndex];
  pos.forEach((p, i) => {
    p.x = damp(p.x, p.tx, 0.09, dt); p.y = damp(p.y, p.ty, 0.09, dt);
    stars[i].style.transform = `translate(${p.x}px, ${p.y}px)`;
    // leader line to the nearest edge of the label; hidden when the label sits right beside the star
    const o = labelOff[i], t = gTies.children[i];
    const cx = Math.max(p.x + o.dx, Math.min(p.x, p.x + o.dx + o.w));
    const cy = Math.max(p.y + o.dy, Math.min(p.y, p.y + o.dy + o.h));
    setLine(t, [p.x, p.y], [cx, cy]);
    t.style.opacity = Math.hypot(cx - p.x, cy - p.y) > 13 ? 1 : 0;
  });
  const at = si => { const j = f.jobs.indexOf(si); return j >= 0 ? [pos[j].x, pos[j].y] : f.px[si]; };
  f.lines.forEach(([a, b], n) => setLine(gLines.children[n], at(a), at(b)));
}

$('const-prev').addEventListener('click', () => setFormation(formIndex - 1));
$('const-next').addEventListener('click', () => setFormation(formIndex + 1));
constStage.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') setFormation(formIndex - 1);
  if (e.key === 'ArrowRight') setFormation(formIndex + 1);
});
{ // horizontal swipe changes formation; mostly-vertical drags are left to page scroll
  let sx = null, sy = 0, done = false;
  constStage.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; done = false; });
  constStage.addEventListener('pointermove', e => {
    if (sx === null || done) return;
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(e.clientY - sy)) { setFormation(formIndex + (dx < 0 ? 1 : -1)); done = true; }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => constStage.addEventListener(t, () => { sx = null; }));
}

/* ---------- skills: a draggable sphere of tags ---------- */
const cloudStage = $('cloud-stage'), tags = [...cloudStage.querySelectorAll('.tag')];
const FONT = { 3: 0.9, 2: 0.7, 1: 0.56 }; // rem per weight
const cloud = { rx: 200, ry: 200, ax: -0.25, ay: 0, vx: 0.0012, vy: 0.0028, drag: false, flat: false, lx: 0, ly: 0, pts: [], maxHalf: 110, onScreen: false };

function buildCloud() {
  const n = tags.length;
  cloud.pts = tags.map((el, i) => { // Fibonacci sphere: even spacing, no clumps
    const phi = Math.acos(-1 + (2 * i + 1) / n), theta = Math.sqrt(n * Math.PI) * phi;
    el.style.fontSize = FONT[el.dataset.w] + 'rem';
    return { el, x: Math.cos(theta) * Math.sin(phi), y: Math.sin(theta) * Math.sin(phi), z: Math.cos(phi) };
  });
  cloud.maxHalf = Math.max(...tags.map(t => t.offsetWidth)) / 2;
  sizeCloud();
}

function sizeCloud() {
  cloud.flat = cloudStage.clientWidth < 560; // longest labels outgrow the ball below this
  cloudStage.classList.toggle('flat', cloud.flat);
  if (cloud.flat) { tags.forEach(t => { t.style.transform = ''; t.style.opacity = ''; t.style.zIndex = ''; }); return; }
  // with focal length 1.9r a projected point can land up to ~1.18r out, so clamp with K = 1.2
  const r = cloudStage.getBoundingClientRect(), K = 1.2, OVAL = 1.18;
  const rad = Math.max(110, Math.min(r.width * 0.36, (r.width / 2 - cloud.maxHalf - 8) / (K * OVAL), (r.height / 2 - 16) / K));
  cloud.rx = rad * OVAL; cloud.ry = rad;
}

new IntersectionObserver(([e]) => { cloud.onScreen = e.isIntersecting; }, { rootMargin: '15% 0px' }).observe(cloudStage);

function renderCloud(dt) {
  if (!cloud.onScreen || cloud.flat) return;
  const cx = cloudStage.clientWidth / 2, cy = cloudStage.clientHeight / 2, fov = cloud.rx * 1.9, f = dt * 60;
  if (!cloud.drag) { // coast, then relax back to the idle spin
    cloud.ay += cloud.vy * f; cloud.ax += cloud.vx * f;
    cloud.vy = damp(cloud.vy, 0.0028, 0.02, dt); cloud.vx = damp(cloud.vx, 0.0012, 0.02, dt);
  }
  const cY = Math.cos(cloud.ay), sY = Math.sin(cloud.ay), cX = Math.cos(cloud.ax), sX = Math.sin(cloud.ax);
  for (const p of cloud.pts) {
    const x1 = p.x * cY - p.z * sY, z1 = p.x * sY + p.z * cY;
    const y2 = p.y * cX - z1 * sX, z2 = p.y * sX + z1 * cX;
    const s = fov / (fov + z2 * cloud.rx);
    p.el.style.transform = `translate(${cx + x1 * cloud.rx * s}px, ${cy + y2 * cloud.ry * s}px) translate(-50%, -50%) scale(${s.toFixed(3)})`;
    p.el.style.zIndex = Math.round(s * 200);
    const depth = clamp01((s - 0.5) / 0.85);
    p.el.style.opacity = (0.12 + 0.88 * depth * depth).toFixed(3);
  }
}

cloudStage.addEventListener('pointerdown', e => {
  if (cloud.flat) return;
  cloud.drag = true; cloud.lx = e.clientX; cloud.ly = e.clientY;
  cloudStage.setPointerCapture(e.pointerId);
});
cloudStage.addEventListener('pointermove', e => {
  if (!cloud.drag) return;
  const dx = e.clientX - cloud.lx, dy = e.clientY - cloud.ly;
  cloud.lx = e.clientX; cloud.ly = e.clientY;
  cloud.ay += dx * 0.005; cloud.ax -= dy * 0.005;
  cloud.vy = dx * 0.0016; cloud.vx = -dy * 0.0016;
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cloudStage.addEventListener(t, () => { cloud.drag = false; }));

document.querySelectorAll('.skills-filter').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.skills-filter').forEach(b => b.classList.toggle('active', b === btn));
  const cat = btn.dataset.filter;
  tags.forEach(t => {
    const hit = cat === 'all' || t.dataset.cat === cat;
    t.classList.toggle('dim', !hit);
    t.classList.toggle('match', hit && cat !== 'all');
  });
}));

/* ---------- contact: Send launches a rocket out of the button ----------
   Messages go through Web3Forms (free, no server) to the inbox registered for this key. The key is meant to be
   public; it can only submit to that inbox. */
const WEB3FORMS_KEY = '7521f6c9-a0cd-4f25-a1af-6e5100f353e1';
const MY_EMAIL = 'omkargadakh1272004@gmail.com';
const form = $('contact-form'), sendBtn = form.querySelector('.send'), sendNote = $('send-note');

function puff(x, y, spread = 40) {
  const p = document.createElement('span');
  p.className = 'puff';
  document.body.append(p);
  const s = 1.6 + Math.random() * 1.8;
  p.animate([
    { transform: `translate(${x - 12}px, ${y - 12}px) scale(.4)`, opacity: .95 },
    { transform: `translate(${x - 12 + (Math.random() - .5) * spread}px, ${y - 12 + 20 + Math.random() * 40}px) scale(${s})`, opacity: 0 }
  ], { duration: 900 + Math.random() * 600, easing: 'cubic-bezier(.16, 1, .3, 1)' }).onfinish = () => p.remove();
}

// resolves when the rocket has left the screen
function launchRocket() {
  if (reduceMotion) return Promise.resolve();
  const icon = sendBtn.querySelector('.send-rocket').getBoundingClientRect();
  const x0 = icon.left + icon.width / 2, y0 = icon.top + icon.height / 2;
  const rocket = document.createElement('div');
  rocket.className = 'mini-rocket';
  rocket.innerHTML = '<i></i><svg viewBox="0 0 40 80"><use href="#rocket"/></svg>';
  document.body.append(rocket);
  sendBtn.classList.add('launching', 'ignite');
  const IGNITE = 380, FLY = 1400, t0 = performance.now();
  let lastPuff = 0;
  return new Promise(resolve => requestAnimationFrame(function step(now) {
    const t = now - t0, ig = Math.min(1, t / IGNITE), u = Math.max(0, Math.min(1, (t - IGNITE) / FLY));
    const k = Math.pow(u, 2.4), dist = y0 + 140;            // slow lift, then gone off the top
    const x = x0 + 40 * k * k, y = y0 - k * dist;
    const scale = 0.34 + 0.66 * ig * ig * (3 - 2 * ig);     // grows out of the 12px icon
    const angle = 45 * (1 - ig) + Math.atan2(80 * k, dist) * 180 / Math.PI; // icon tilt to vertical, then along the path
    rocket.style.transform = `translate(${x - 18}px, ${y - 36}px) rotate(${angle.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
    if (now - lastPuff > (u ? 24 : 45)) { lastPuff = now; puff(x, y + 34 * scale, u ? 34 : 90); }
    if (u < 1) return requestAnimationFrame(step);
    rocket.remove();
    sendBtn.classList.remove('launching', 'ignite');
    resolve();
  }));
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (data.botcheck) return;
  sendBtn.disabled = true;
  sendNote.textContent = 'Ignition...';
  const flight = launchRocket();
  let ok = false;
  try {
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY, subject: `Portfolio message from ${data.name}`, from_name: 'Omkar Gadakh portfolio',
        name: data.name, email: data.email, organisation: data.org, topic: data.topic, message: data.message
      })
    });
    ok = res.ok && (await res.json()).success === true;
  } catch { /* network error: ok stays false */ }
  await flight;
  sendNote.textContent = ok ? 'Message launched. I will get back to you soon.' : `That didn't go through. Please email ${MY_EMAIL}.`;
  if (ok) form.reset();
  sendBtn.disabled = false;
});


/* ---------- the one loop ---------- */
const heroPin = $('hero-pin'), skills = $('skills');
let sky = null, last = performance.now();

function tick(now) {
  const dt = (state.dt = Math.min(0.05, (now - last) / 1000 || 1 / 60)); last = now;
  state.progress = maxScroll() ? clamp01(scrollY / maxScroll()) : 0;
  root.style.setProperty('--p', state.progress.toFixed(4));
  const hp = heroPin.getBoundingClientRect();
  root.style.setProperty('--hero-out', clamp01(-hp.top / (hp.height - innerHeight || 1)).toFixed(4));
  // clear the scenery before Skills so it doesn't fight the tag sphere
  const skillsTop = skills.getBoundingClientRect().top + scrollY;
  state.clutter = 1 - range(scrollY, skillsTop - innerHeight * 1.4, skillsTop - innerHeight * 0.35);

  orbitSatellite(now * 0.00042);
  renderConstellation(dt);
  sweepReveals();
  renderCloud(dt);
  sky?.(state);
  requestAnimationFrame(tick);
}

addEventListener('resize', () => { sizeCloud(); setFormation(formIndex); }, { passive: true });

/* ---------- launch: the loading counter is the countdown ---------- */
let loaded = 0, shown = 0, counting = true;
const bump = () => { loaded = Math.min(100, loaded + 100 / 3); };
document.fonts.ready.then(bump);
Promise.all([...document.images].map(img => img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; }))).then(bump);
addEventListener('sky-ready', () => { sky = window.__sky; }, { once: true }); // render as soon as the scene exists
addEventListener('sky-loaded', bump, { once: true });                         // count it loaded once the Earth textures are in
setTimeout(() => { loaded = 100; }, 6000); // never trap anyone behind a hung CDN
setTimeout(() => { if (!window.__sky) document.body.classList.add('no-webgl'); }, 6500);

function revealSite() {
  $('preloader').classList.add('done');
  document.body.classList.remove('loading');
  heroInner.classList.add('lit');
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))); // never throws, unlike querySelector('#1')
  if (target) requestAnimationFrame(() => scrollToY(sectionY(target)));
}

function launch() {
  counting = false;
  $('pre-count').textContent = '100';
  $('pre-status').textContent = 'Ignition';
  const t0 = performance.now(), LAUNCH_MS = 2600;
  let revealed = false;
  requestAnimationFrame(function fly(now) {
    const t = Math.min(1, (now - t0) / LAUNCH_MS);
    state.launchT = t;
    if (t > 0.12) $('pre-status').textContent = 'Liftoff';
    // start assembling the name while still climbing, so the two motions overlap
    if (t > 0.5 && !revealed) { revealed = true; revealSite(); }
    if (t < 1) requestAnimationFrame(fly);
    else $('preloader').style.display = 'none';
  });
}

(function countdown() {
  if (!counting) return;
  shown += (loaded - shown) * 0.08;
  if (loaded >= 100 && shown > 99) shown = 100;
  $('pre-fill').style.right = (100 - shown) + '%';
  $('pre-count').textContent = String(Math.min(99, Math.round(shown))).padStart(2, '0');
  if (shown >= 99.5) setTimeout(launch, 220);
  else requestAnimationFrame(countdown);
})();

document.fonts.ready.then(() => {
  buildCloud();
  setFormation(0);
  requestAnimationFrame(tick);
});
