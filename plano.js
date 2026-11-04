// Plan view of the site page (site.html): the car park drawn to scale (outline with its measurements, bays, main board,
// chargers) and the cables from the main board to the chargers. Each cable has its breaker and cross-section; the page
// shows its current and an approximate voltage drop, the local balancer (SB) respects it and, if it is overloaded for
// longer than the main breaker setting, it trips and its chargers lose power.
//
// The calculations are pure functions (OvcPlano.calc) so they can be tested in Node. The view is mounted by site.js.
(function (root) {
  'use strict';
  var SQ3 = Math.sqrt(3), GAMMA = 48, DROP_LIMIT = 5, MIN_MM2 = 2.5;
  var SECTIONS = [2.5, 4, 6, 10, 16, 25, 35, 50];
  var BREAKERS = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];

  // ── Calculations ────────────────────────────────────────────────────────────────────────────────────
  function r2(n) { return Math.round(n * 100) / 100; }
  function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

  // Outline as a turtle walk: start point, first heading (degrees, 0 = east, y grows downwards), and stretches of
  // { l: metres, t: turn after it in degrees, + = right }. Returns the corner points, the last one included.
  function outlinePoints(o) {
    var x = o.x0, y = o.y0, h = o.h0 || 0, pts = [[x, y]];
    (o.tramos || []).forEach(function (s) {
      var a = h * Math.PI / 180;
      x = r2(x + s.l * Math.cos(a)); y = r2(y + s.l * Math.sin(a));
      pts.push([x, y]); h += s.t || 0;
    });
    return pts;
  }
  // How far the end of a closed outline is from its start (0 = it closes). Never closed by itself: the page says so.
  function closureGap(o) {
    var p = outlinePoints(o); if (!o.closed || p.length < 4) return null;
    var e = p[p.length - 1], s = p[0];
    return { dx: r2(s[0] - e[0]), dy: r2(s[1] - e[1]), d: r2(dist(e, s)) };
  }
  function norm180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }
  // Adds a point to the outline being drawn: the previous stretch gets its turn, the new one its length.
  function outlineAdd(o, p) {
    var pts = outlinePoints(o), last = pts[pts.length - 1];
    var l = r2(dist(last, p)); if (l < 0.05) return o;
    var hd = Math.atan2(p[1] - last[1], p[0] - last[0]) * 180 / Math.PI;
    if (!o.tramos.length) o.h0 = Math.round(hd * 10) / 10;
    else {
      var h = o.h0; o.tramos.forEach(function (s, i) { if (i < o.tramos.length - 1) h += s.t || 0; });
      o.tramos[o.tramos.length - 1].t = Math.round(norm180(hd - h) * 10) / 10;
    }
    o.tramos.push({ l: l, t: 0 });
    return o;
  }

  // Current of a hose, in amps on its (worst) phase. One-phase hoses are counted as if they all hung on the same
  // phase: on the safe side. DC chargers take three-phase AC. A single-phase supply puts everything on one phase.
  function ampsPerKw(chargerKw, carPhases, supplyPhases) {
    var ph = chargerKw > 22 ? 3 : (chargerKw > 7.4 ? 3 : 1);
    if (ph === 3 && chargerKw <= 22 && carPhases === 1) ph = 1;
    if (supplyPhases === 1) ph = 1;
    return ph === 1 ? 1000 / 230 : 1000 / (SQ3 * 400);
  }

  // Nearest point of a polyline to p: distance along it (s) and straight from it (d)
  function project(route, p) {
    var best = { s: 0, d: Infinity }, acc = 0;
    for (var i = 1; i < route.length; i++) {
      var a = route[i - 1], b = route[i], L = dist(a, b);
      var u = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L))) : 0;
      var q = [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])], d = dist(q, p);
      if (d < best.d) best = { s: acc + u * L, d: d, at: q };
      acc += L;
    }
    if (route.length === 1) best = { s: 0, d: dist(route[0], p), at: route[0] };
    return best;
  }
  function routeLength(route) { var s = 0; for (var i = 1; i < route.length; i++) s += dist(route[i - 1], route[i]); return s; }

  // Voltage drop of a cable, segment by segment: every charger takes its current at its tap on the route and a drop
  // cable from there. ΔU at a charger = k · Σ I_j · min(s_j, s_c) / (γ · S) + k · I_c · d_c / (γ · S), with k = √3 on a
  // three-phase supply (line-to-line, 400 V) and 2 on a single-phase one (230 V). Copper, cos φ = 1. Approximate.
  function lineDrop(line, board, posts, amps, supplyPhases) {
    var route = [board].concat(line.pts || []);
    var taps = (line.chargers || []).filter(function (ci) { return posts[ci]; }).map(function (ci) {
      var pr = project(route, posts[ci]); return { ci: ci, s: pr.s, d: pr.d, at: pr.at, I: amps[ci] || 0 };
    });
    var k = supplyPhases === 1 ? 2 : SQ3, U = supplyPhases === 1 ? 230 : 400, S = Math.max(line.mm2 || MIN_MM2, 0.5);
    var worst = { pct: 0, v: 0, ci: null, len: 0 }, total = 0;
    taps.forEach(function (c) {
      total += c.I;
      var v = taps.reduce(function (acc, j) { return acc + j.I * Math.min(j.s, c.s); }, 0) * k / (GAMMA * S) + k * c.I * c.d / (GAMMA * S);
      c.v = v; c.pct = v / U * 100;
      if (c.pct > worst.pct || worst.ci === null) worst = { pct: c.pct, v: v, ci: c.ci, len: c.s + c.d };
    });
    var far = taps.reduce(function (m, c) { return Math.max(m, c.s + c.d); }, routeLength(route));
    return { taps: taps, amps: total, v: worst.v, pct: worst.pct, worst: worst.ci, length: far };
  }

  // The local balancer's allocation (SB): each hose its minimum by order of arrival while the site and its cable leave
  // room, then the rest in equal shares up to what each wants, never over a cable's breaker. Hoses: { since, min (kW),
  // want (kW), apk (A per kW), line (id or null) }. caps: { lineId: amps }. Returns the hoses with `got` (kW).
  function allocate(hoses, freeKw, caps) {
    var used = {}, free = freeKw;
    var room = function (h) { return h.line != null && caps && caps[h.line] != null ? (caps[h.line] - (used[h.line] || 0)) / h.apk : Infinity; };
    var take = function (h, kw) { h.got += kw; free -= kw; if (h.line != null) used[h.line] = (used[h.line] || 0) + kw * h.apk; };
    hoses.forEach(function (h) { h.got = 0; });
    var served = [];
    hoses.slice().sort(function (a, b) { return a.since - b.since; }).forEach(function (h) {
      if (h.want > 0 && free >= h.min - 1e-9 && room(h) >= h.min - 1e-9) { take(h, h.min); served.push(h); }
    });
    var guard = 0;
    while (served.length && free > 0.01 && guard++ < 50) {
      var share = free / served.length, still = [], onLine = {};
      served.forEach(function (h) { if (h.line != null) onLine[h.line] = (onLine[h.line] || 0) + 1; });
      var roomNow = {};
      served.forEach(function (h) { if (h.line != null && roomNow[h.line] == null) roomNow[h.line] = room(h) * h.apk; });
      served.forEach(function (h) {
        var lineShare = h.line != null && roomNow[h.line] != null ? roomNow[h.line] / onLine[h.line] / h.apk : Infinity;
        var g = Math.max(0, Math.min(share, h.want - h.got, lineShare, room(h)));
        take(h, g);
        if (h.want - h.got > 0.01 && room(h) > 0.01) still.push(h);
      });
      if (!still.length) break;
      served = still;
    }
    return hoses;
  }

  // A plan that fits the default site (four chargers with two hoses each): an L-shaped garage of 40 × 26 m.
  function defaultPlan() {
    return {
      outline: { x0: 0, y0: 0, h0: 0, closed: true,
        tramos: [{ l: 40, t: 90 }, { l: 26, t: 90 }, { l: 24, t: 90 }, { l: 6, t: -90 }, { l: 16, t: 90 }, { l: 20, t: 0 }] },
      rows: [{ a: [3, 0], b: [38, 0] }, { a: [39.5, 26], b: [17, 26] }],
      board: [1.2, 1.2],
      entrance: { wi: 4, s: 8, w: 4 },
      posts: { 0: [5.5, 0.4], 1: [10.5, 0.4], 2: [33, 0.4], 3: [25, 25.6] },
      lines: [
        { id: 'L1', amps: 80, mm2: 25, pts: [[1.2, 6], [10.5, 6]], chargers: [0, 1] },
        { id: 'L2', amps: 32, mm2: 6, pts: [[1.2, 6], [33, 6]], chargers: [2] },
        { id: 'L3', amps: 32, mm2: 6, pts: [[1.2, 6], [20, 6], [20, 22], [25, 22]], chargers: [3] }
      ]
    };
  }

  var calc = { outlinePoints: outlinePoints, closureGap: closureGap, outlineAdd: outlineAdd, ampsPerKw: ampsPerKw,
               project: project, routeLength: routeLength, lineDrop: lineDrop, allocate: allocate, defaultPlan: defaultPlan,
               DROP_LIMIT: DROP_LIMIT, GAMMA: GAMMA };

  // ── The view ────────────────────────────────────────────────────────────────────────────────────────
  function mount(site) {
    var doc = root.document, $ = function (id) { return doc.getElementById(id); };
    var SVGNS = 'http://www.w3.org/2000/svg', cfg = site.cfg, ES = site.ES;
    var T = ES ? {
      tabPark: 'Parking', tabPlan: 'Plano',
      door: '🚪 Entrada', hDoor: 'Pincha en la pared por donde entran los coches (puerta de 4 m). Pincha en otra pared para moverla; con Borrar se quita.',
      entr: 'Entrada', inOut: 'Entrada y salida', tripShort: 'ha saltado',
      nDoor: 'Sin entrada: los coches aparecen directamente en su plaza (🚪 Entrada en la pestaña Plano)',
      move: '✋ Mover', outline: '✏️ Contorno', rows: '▥ Plazas', board: '▣ Cuadro', charger: '⚡ Cargador', line: '〰 Línea', erase: '✕ Borrar',
      hMove: 'Arrastra el cuadro o un cargador. Pincha una línea y arrastra sus puntos; el punto pequeño del medio de cada tramo crea una esquina nueva. Con la instalación encendida, pincha un cargador para mandar un coche (o que se vaya).',
      hOutline: 'Pincha las esquinas del garaje; para cerrar, pincha en la primera. Las medidas se corrigen abajo, tramo a tramo.',
      hRows: 'Arrastra a lo largo de la pared para poner una fila de plazas de 2,5 × 5 m. Pincha una fila para darle la vuelta.',
      hBoard: 'Pincha donde está el cuadro general (de ahí salen las líneas).',
      hCharger: 'Pincha donde va el siguiente cargador sin colocar. ',
      hAllPlaced: 'Todos los cargadores están colocados: muévelos con Mover o quita uno con Borrar.',
      hLine: 'Pincha por donde va el cable (bandeja) y en los cargadores que cuelgan de él; termina con doble clic o Intro. Con una línea elegida a la derecha, pinchar un cargador lo mete o lo saca de ella.',
      hNoBoard: 'Primero pon el cuadro: de ahí salen las líneas.',
      hErase: 'Pincha una fila de plazas, un cargador, una línea o el cuadro para quitarlo; en la línea elegida, pincha una esquina para quitar solo esa esquina.',
      tramos: 'Contorno, tramo a tramo', len: 'm', turn: 'luego', right: '90° der.', left: '90° izq.', straight: 'recto',
      r45: '45° der.', l45: '45° izq.', r135: '135° der.', l135: '135° izq.',
      closes: '✓ El contorno cierra', gap: 'No cierra: faltan {d} m hasta el inicio ({dx} m en horizontal, {dy} m en vertical). Corrige una medida; no lo cerramos por nuestra cuenta.',
      open: 'Contorno abierto: pincha en la primera esquina para cerrarlo.', clearOutline: 'Borrar contorno', none: 'Sin contorno: dibújalo con la herramienta Contorno.',
      lines: 'Líneas', noLines: 'Sin líneas: dibújalas con la herramienta Línea, desde el cuadro.', breaker: 'Protección (A)', section: 'Sección (mm²)',
      length: 'Hasta el más lejano', current: 'Corriente', drop: 'Caída', del: 'Quitar', finish: 'Terminar línea', cancelLine: 'Cancelar',
      full: 'a plena carga', live: 'ahora', over: 'Sobrecarga: pasa de {a} A', overFull: 'A plena carga pasaría de {a} A', tripIn: 'Salta {n} en {s} s', tripped: '⚡ Ha saltado {n}: sin luz {s} s',
      noChargers: 'sin cargadores', limit: 'límite {p} %',
      nOpen: 'Tu plano aún no se usa aquí: el contorno está abierto. Ciérralo en la pestaña Plano pinchando en la primera esquina.',
      nGap: 'Tu plano aún no se usa aquí: el contorno no cierra (faltan {d} m). Corrige una medida en la pestaña Plano.',
      nRows: 'Sin plazas dibujadas: los coches aparcan junto a su cargador (▥ Plazas en la pestaña Plano)',
      nPosts: 'Sin colocar en el plano: {n} (⚡ Cargador en la pestaña Plano)',
      dropNote: 'Caída de tensión aproximada: cobre a γ = 48, cos φ = 1, cada cargador en su punto de la línea; las monofásicas, como si fueran todas a la misma fase. Límite del 5 % desde el origen del circuito hasta el punto de recarga (ITC-BT-52, España); comprueba la norma de tu país. Para un proyecto, el cálculo bueno lo hace un programa de cálculo eléctrico.',
      save: 'Guardar plano (.json)', load: 'Cargar plano', reset: 'Plano de ejemplo', newP: 'Nuevo parking', newQ: 'Se borra el plano actual (guárdalo antes si lo quieres).', newYes: 'Empezar de cero', newNo: 'Cancelar', bad: 'Ese fichero no es un plano del simulador.',
      unplaced: 'Sin colocar: {n}', sbLines: 'El SB respeta también la protección de cada línea.'
    } : {
      tabPark: 'Car park', tabPlan: 'Plan',
      door: '🚪 Entrance', hDoor: 'Click the wall where cars come in (a 4 m door). Click another wall to move it; Delete removes it.',
      entr: 'Entrance', inOut: 'Way in and out', tripShort: 'tripped',
      nDoor: 'No entrance: cars appear straight in their bay (🚪 Entrance in the Plan tab)',
      move: '✋ Move', outline: '✏️ Outline', rows: '▥ Bays', board: '▣ Main board', charger: '⚡ Charger', line: '〰 Line (cable)', erase: '✕ Delete',
      hMove: 'Drag the main board or a charger. Click a cable and drag its points; the small dot in the middle of each stretch makes a new corner. With the site on, click a charger to send a car (or make it leave).',
      hOutline: 'Click the corners of the garage; click the first one to close it. Fix the measurements below, stretch by stretch.',
      hRows: 'Drag along the wall to add a row of 2.5 × 5 m bays. Click a row to flip it.',
      hBoard: 'Click where the main board is (the cables start there).',
      hCharger: 'Click where the next unplaced charger goes. ',
      hAllPlaced: 'Every charger is placed: drag them with Move or remove one with Delete.',
      hLine: 'Click along the cable route (tray) and on the chargers it feeds; finish with a double click or Enter. With a cable picked on the right, clicking a charger adds it to it or takes it off.',
      hNoBoard: 'Place the main board first: the cables start there.',
      hErase: 'Click a row of bays, a charger, a cable or the main board to remove it; on the picked cable, click a corner to remove just that corner.',
      tramos: 'Outline, stretch by stretch', len: 'm', turn: 'then', right: '90° right', left: '90° left', straight: 'straight',
      r45: '45° right', l45: '45° left', r135: '135° right', l135: '135° left',
      closes: '✓ The outline closes', gap: 'It does not close: {d} m short of the start ({dx} m across, {dy} m down). Fix a measurement; we do not close it for you.',
      open: 'Open outline: click the first corner to close it.', clearOutline: 'Clear outline', none: 'No outline yet: draw it with the Outline tool.',
      lines: 'Cables', noLines: 'No cables yet: draw them with the Cable tool, from the main board.', breaker: 'Breaker (A)', section: 'Section (mm²)',
      length: 'To the farthest', current: 'Current', drop: 'Drop', del: 'Remove', finish: 'Finish cable', cancelLine: 'Cancel',
      full: 'at full load', live: 'now', over: 'Overload: above {a} A', overFull: 'At full load it would go above {a} A', tripIn: '{n} trips in {s} s', tripped: '⚡ {n} tripped: no power for {s} s',
      noChargers: 'no chargers', limit: '{p} % limit',
      nOpen: 'Your plan is not used here yet: the outline is open. Close it in the Plan tab by clicking the first corner.',
      nGap: 'Your plan is not used here yet: the outline does not close ({d} m short). Fix a measurement in the Plan tab.',
      nRows: 'No bays drawn: cars park next to their charger (▥ Bays in the Plan tab)',
      nPosts: 'Not placed on the plan: {n} (⚡ Charger in the Plan tab)',
      dropNote: 'Approximate voltage drop: copper at γ = 48, cos φ = 1, each charger at its point on the cable; single-phase hoses counted as if all on the same phase. 5 % limit from the origin of the circuit to the charging point (Spain, ITC-BT-52); check your local rules. For a real project, use a proper electrical design tool.',
      save: 'Save plan (.json)', load: 'Load plan', reset: 'Sample plan', newP: 'New car park', newQ: 'This clears the current plan (save it first if you want it).', newYes: 'Start from scratch', newNo: 'Cancel', bad: 'That file is not a plan from this simulator.',
      unplaced: 'Not placed: {n}', sbLines: 'The SB also respects each cable\'s breaker.'
    };
    function t(k, v) { var s = T[k] || k; Object.keys(v || {}).forEach(function (x) { s = s.split('{' + x + '}').join(v[x]); }); return s; }
    function fmt(n, d) { return Number(n || 0).toLocaleString(ES ? 'es-ES' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); }
    function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
    function el(tag, attrs, parent) {
      var e = doc.createElementNS(SVGNS, tag);
      if (tag === 'text' && attrs && /clab|plbl/.test(attrs['class'] || '')) attrs['stroke-width'] = r2(0.28 * U);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (parent) parent.appendChild(e);
      return e;
    }

    if (!cfg.plan || !cfg.plan.outline) cfg.plan = defaultPlan();
    var plan = cfg.plan;
    plan.rows = plan.rows || []; plan.posts = plan.posts || {}; plan.lines = plan.lines || [];
    var tool = 'move', drawing = null, drag = null, selLine = plan.lines.length ? plan.lines[0].id : null, runtime = {};
    function save() { site.save(); }

    // Tabs: the car park as it was, or the plan
    var view = cfg.view === 'plan' || /^#(plan|plano)$/.test(root.location.hash) ? 'plan' : 'park';
    $('tab-park').textContent = T.tabPark; $('tab-plan').textContent = T.tabPlan;
    function showView(v) {
      view = v; cfg.view = v; save();
      $('park-view').hidden = v !== 'park'; $('plan-view').hidden = v !== 'plan'; $('lines-box').hidden = v !== 'plan';
      $('tab-park').className = v === 'park' ? 'on' : ''; $('tab-plan').className = v === 'plan' ? 'on' : '';
      $('tab-park').setAttribute('aria-selected', String(v === 'park')); $('tab-plan').setAttribute('aria-selected', String(v === 'plan'));
      if (v === 'plan') { draw(); sidePanel(); } else drawPark();
    }
    $('tab-park').onclick = function () { showView('park'); };
    $('tab-plan').onclick = function () { showView('plan'); };

    // Tools
    var TOOLS = ['move', 'outline', 'rows', 'door', 'board', 'charger', 'line', 'erase'];
    $('plan-tools').innerHTML = TOOLS.map(function (k) { return '<button type="button" data-tool="' + k + '">' + T[k] + '</button>'; }).join('');
    Array.prototype.forEach.call($('plan-tools').querySelectorAll('button'), function (b) {
      b.onclick = function () { setTool(b.dataset.tool); };
    });
    function setTool(k) {
      if (drawing && drawing.kind === 'line' && k !== 'line') finishLine(false);
      if (drawing && drawing.kind !== 'line') drawing = null;
      tool = k;
      Array.prototype.forEach.call($('plan-tools').querySelectorAll('button'), function (b) { b.className = b.dataset.tool === k ? 'on' : ''; });
      hint(); draw();
    }
    function nChargers() { return cfg.n; }
    // The entrance: a gap in one wall of the outline (wall index, distance along it to the middle, width)
    function inside(p, poly) {
      var c = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var a = poly[i], b = poly[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    }
    function wallNearest(p) {
      var op = outlinePoints(plan.outline), best = null;
      for (var i = 1; i < op.length; i++) { var pr = project([op[i - 1], op[i]], p); if (!best || pr.d < best.d) best = { wi: i - 1, s: pr.s, d: pr.d }; }
      return best;
    }
    function entrance() {
      var e = plan.entrance; if (!e) return null;
      var op = outlinePoints(plan.outline), a = op[e.wi], b = op[e.wi + 1]; if (!a || !b) return null;
      var L = dist(a, b); if (L < 1) return null;
      var w = Math.min(e.w || 4, L), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, sm = Math.max(w / 2, Math.min(L - w / 2, e.s));
      var c = [a[0] + ux * sm, a[1] + uy * sm], nx = -uy, ny = ux;
      if (!inside([c[0] + nx * 0.5, c[1] + ny * 0.5], op)) { nx = -nx; ny = -ny; }
      return { c: c, u: [ux, uy], n: [nx, ny], w: w, a: [c[0] - ux * w / 2, c[1] - uy * w / 2], b: [c[0] + ux * w / 2, c[1] + uy * w / 2] };
    }
    function unplaced() { var u = []; for (var i = 0; i < nChargers(); i++) if (!plan.posts[i]) u.push(i); return u; }
    function hint() {
      var h = tool === 'move' ? T.hMove : tool === 'outline' ? T.hOutline : tool === 'rows' ? T.hRows : tool === 'door' ? T.hDoor : tool === 'board' ? T.hBoard
        : tool === 'charger' ? (unplaced().length ? T.hCharger + t('unplaced', { n: unplaced().map(function (i) { return cfg.chargers[i].name; }).join(', ') }) : T.hAllPlaced)
        : tool === 'line' ? (plan.board ? T.hLine : T.hNoBoard) : T.hErase;
      $('plan-hint').textContent = h;
      $('line-actions').hidden = !(drawing && drawing.kind === 'line');
    }

    // Coordinates: the SVG works in metres; the view box fits the drawing
    var svg = $('plan-svg'), vb = { x: -4, y: -4, w: 60, h: 40 }, U = 1;
    function fit() {
      var pts = outlinePoints(plan.outline).slice();
      plan.rows.forEach(function (r) { pts.push(r.a, r.b); });
      Object.keys(plan.posts).forEach(function (k) { pts.push(plan.posts[k]); });
      if (plan.board) pts.push(plan.board);
      // While the outline is open, a steady canvas of at least 60 × 40 m: the view must not jump between clicks
      if (!plan.outline.closed) { var o0 = [plan.outline.x0 || 0, plan.outline.y0 || 0]; pts.push([o0[0] - 4, o0[1] - 4], [o0[0] + 56, o0[1] + 36]); }
      var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      var w = Math.max(20, x1 - x0), h = Math.max(12, y1 - y0), pad = Math.max(w, h) * 0.12 + 2;
      vb = { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
      U = vb.w / 90;                                   // one "unit" for text and markers, about 1/90 of the width
      svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map(function (n) { return r2(n); }).join(' '));
    }
    function toM(ev) {
      var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      var p = pt.matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y];
    }
    function snapFrom(prev, p) {                      // 0.05 m, and angles that are multiples of 45° when close to one
      if (!prev) return [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2];
      var dx = p[0] - prev[0], dy = p[1] - prev[1], L = Math.hypot(dx, dy), a = Math.atan2(dy, dx) * 180 / Math.PI;
      var a45 = Math.round(a / 45) * 45;
      if (Math.abs(a - a45) < 7) a = a45;
      L = Math.round(L * 20) / 20;
      return [r2(prev[0] + L * Math.cos(a * Math.PI / 180)), r2(prev[1] + L * Math.sin(a * Math.PI / 180))];
    }

    // What each charger draws now (amps on its worst phase), or at full power when the site is off
    function ampsNow() {
      var live = site.live(), out = {}, on = site.running();
      for (var ci = 0; ci < nChargers(); ci++) {
        var c = cfg.chargers[ci];
        if (on && live[ci]) {
          out[ci] = live[ci].charger.state.connectors.reduce(function (s, k) {
            return s + (k.powerKw || 0) * ampsPerKw(c.kw, k.car && k.car.phases, cfg.phases);
          }, 0);
        } else out[ci] = Math.min(c.max, c.kw * c.hoses) * ampsPerKw(c.kw, 3, cfg.phases);
      }
      return out;
    }
    function lineOf(ci) { for (var i = 0; i < plan.lines.length; i++) if (plan.lines[i].chargers.indexOf(ci) >= 0) return plan.lines[i]; return null; }
    function calcAll() {
      var a = ampsNow(), out = {};
      plan.lines.forEach(function (l) { out[l.id] = plan.board ? lineDrop(l, plan.board, plan.posts, a, cfg.phases) : null; });
      return out;
    }
    var stateColor = function (p) { return p > DROP_LIMIT ? 'var(--bad)' : p > 3 ? 'var(--wait)' : 'var(--av)'; };

    // ── Drawing ──
    function draw() {
      if (view !== 'plan') return;
      if (!drag) fit();
      svg.innerHTML = '';
      var res = calcAll(), now = Date.now();
      // Outline and its measurements
      var pts = outlinePoints(plan.outline), gap = closureGap(plan.outline);
      if (pts.length > 1) {
        var closedOk = plan.outline.closed && gap && gap.d < 0.05;
        el(closedOk ? 'polygon' : 'polyline', { points: pts.map(function (p) { return p.join(','); }).join(' '), class: 'wall' + (closedOk ? '' : ' open') }, svg);
        if (plan.outline.closed && gap && gap.d >= 0.05) {
          el('line', { x1: pts[pts.length - 1][0], y1: pts[pts.length - 1][1], x2: pts[0][0], y2: pts[0][1], class: 'gapline' }, svg);
        }
        pts.slice(1).forEach(function (p, i) {
          var a = pts[i], mx = (a[0] + p[0]) / 2, my = (a[1] + p[1]) / 2, L = dist(a, p);
          var nx = (p[1] - a[1]) / (L || 1), ny = -(p[0] - a[0]) / (L || 1);   // to the left of the walk: outside on a clockwise outline
          el('text', { x: r2(mx + nx * 1.3 * U), y: r2(my + ny * 1.3 * U + (Math.abs(ny) > 0.5 ? (ny > 0 ? 1.1 : 0) : 0.4) * U), class: 'cota', 'font-size': r2(1.25 * U),
                       'text-anchor': nx > 0.5 ? 'start' : nx < -0.5 ? 'end' : 'middle' }, svg)
            .textContent = fmt(plan.outline.tramos[i].l, 2) + ' m';
        });
        el('circle', { cx: pts[0][0], cy: pts[0][1], r: r2(0.5 * U), class: 'start' }, svg);
      }
      // Entrance: a gap in the wall and an arrow in
      var en = entrance();
      if (en) {
        el('line', { x1: r2(en.a[0]), y1: r2(en.a[1]), x2: r2(en.b[0]), y2: r2(en.b[1]), class: 'door' }, svg);
        [en.a, en.b].forEach(function (q) { el('line', { x1: r2(q[0] - en.n[0] * 0.5), y1: r2(q[1] - en.n[1] * 0.5), x2: r2(q[0] + en.n[0] * 0.5), y2: r2(q[1] + en.n[1] * 0.5), class: 'jamb' }, svg); });
        arrowIn(en, svg, 'doorarrow');
        el('text', { x: r2(en.c[0] + en.n[0] * (3 + 2.2 * U)), y: r2(en.c[1] + en.n[1] * (3 + 1.6 * U) + 0.4 * U), 'text-anchor': 'middle', 'font-size': r2(1.15 * U), class: 'clab' }, svg).textContent = T.entr;   // inside: the wall's measurement is outside
      }
      // Bays
      plan.rows.forEach(function (r, ri) {
        var L = dist(r.a, r.b), ux = (r.b[0] - r.a[0]) / (L || 1), uy = (r.b[1] - r.a[1]) / (L || 1);
        var sd = r.flip ? -1 : 1, nx = -uy * sd, ny = ux * sd, n = Math.floor(L / 2.5 + 1e-6);
        // right-hand normal of the drag direction on screen (y down): (−uy, ux)
        for (var i = 0; i < n; i++) {
          var p0 = [r.a[0] + ux * 2.5 * i, r.a[1] + uy * 2.5 * i], p1 = [p0[0] + ux * 2.5, p0[1] + uy * 2.5];
          var q = [p0, p1, [p1[0] + nx * 5, p1[1] + ny * 5], [p0[0] + nx * 5, p0[1] + ny * 5]];
          el('polygon', { points: q.map(function (p) { return r2(p[0]) + ',' + r2(p[1]); }).join(' '), class: 'pbay', 'data-row': ri }, svg);
        }
      });
      // Cable tray: every route, faint and wide
      if (plan.board) plan.lines.forEach(function (l) {
        el('polyline', { points: [plan.board].concat(l.pts).map(function (p) { return p.join(','); }).join(' '), class: 'tray', 'stroke-width': r2(1.6 * U) }, svg);
      });
      // Cables, side by side in the tray, coloured by their drop
      plan.lines.forEach(function (l, li) {
        if (!plan.board) return;
        var r = res[l.id], off = (li - (plan.lines.length - 1) / 2) * 0.45 * U, rt = runtime[l.id] || {};
        var col = rt.tripUntil > now ? 'var(--bad)' : r && r.taps.length ? stateColor(r.pct) : 'var(--off)';
        var route = [plan.board].concat(l.pts).map(function (p) { return r2(p[0] + off) + ',' + r2(p[1] + off); }).join(' ');
        el('polyline', { points: route, class: 'cable' + (l.id === selLine ? ' sel' : '') + (rt.tripUntil > now ? ' cut' : ''), stroke: col }, svg);
        if (r) r.taps.forEach(function (tp) {
          el('line', { x1: r2(tp.at[0] + off), y1: r2(tp.at[1] + off), x2: plan.posts[tp.ci][0], y2: plan.posts[tp.ci][1], class: 'cable drop', stroke: col }, svg);
        });
        var lab = l.pts.length ? l.pts[l.pts.length - 1] : plan.board;
        if (r && r.taps.length) el('text', { x: r2(lab[0] + off + 0.8 * U), y: r2(lab[1] + off - 0.8 * U), class: 'clab', 'font-size': r2(1.3 * U), fill: col }, svg)
          .textContent = l.id + ' · ' + fmt(r.amps, 1) + ' / ' + l.amps + ' A · ' + fmt(r.pct, 1) + ' %';
      });
      // Handles of the picked cable: its corners, and a small dot in the middle of each stretch to add one
      handles().forEach(function (h) {
        el('circle', { cx: r2(h.p[0]), cy: r2(h.p[1]), r: r2((h.kind === 'vertex' ? 0.55 : 0.35) * U), class: 'handle' + (h.kind === 'mid' ? ' mid' : '') }, svg);
      });
      // The line being drawn
      if (drawing && drawing.kind === 'line') {
        var dp = [plan.board].concat(drawing.pts);
        if (drawing.hover) dp.push(drawing.hover);
        el('polyline', { points: dp.map(function (p) { return p.join(','); }).join(' '), class: 'cable drawing' }, svg);
      }
      if (drawing && drawing.kind === 'outline' && drawing.hover && pts.length) {
        var lp = pts[pts.length - 1];
        el('line', { x1: lp[0], y1: lp[1], x2: drawing.hover[0], y2: drawing.hover[1], class: 'cable drawing' }, svg);
        el('text', { x: drawing.hover[0] + U, y: drawing.hover[1] - U, class: 'clab', 'font-size': r2(1.3 * U) }, svg).textContent = fmt(dist(lp, drawing.hover), 2) + ' m';
      }
      if (drawing && drawing.kind === 'row' && drawing.b) {
        el('line', { x1: drawing.a[0], y1: drawing.a[1], x2: drawing.b[0], y2: drawing.b[1], class: 'cable drawing' }, svg);
        el('text', { x: drawing.b[0] + U, y: drawing.b[1] - U, class: 'clab', 'font-size': r2(1.3 * U) }, svg).textContent =
          Math.floor(dist(drawing.a, drawing.b) / 2.5 + 1e-6) + ' × 2,5 m';
      }
      // Main board
      if (plan.board) {
        var b = el('g', { class: 'pnode', 'data-kind': 'board' }, svg);
        el('rect', { x: r2(plan.board[0] - 1.1 * U), y: r2(plan.board[1] - 1.1 * U), width: r2(2.2 * U), height: r2(2.2 * U), rx: r2(0.3 * U), class: 'boardbox' }, b);
        el('text', { x: plan.board[0], y: r2(plan.board[1] + 0.45 * U), 'text-anchor': 'middle', 'font-size': r2(1.1 * U), class: 'boardtxt' }, b).textContent = 'CG';
        var topY = Math.min.apply(null, outlinePoints(plan.outline).map(function (q) { return q[1]; }).concat([plan.board[1]]));
        el('text', { x: r2(plan.board[0] - 1.1 * U), y: r2(topY - 1.4 * U), 'font-size': r2(1.2 * U), class: 'clab' }, svg)
          .textContent = 'LGA ' + fmt(cfg.grid, 1) + ' kW';
      }
      // Chargers: status, name, and what each hose draws
      var live = site.live();
      for (var ci = 0; ci < nChargers(); ci++) {
        var p = plan.posts[ci]; if (!p) continue;
        var s = live[ci] ? live[ci].charger.state : null, ln = lineOf(ci), rt2 = ln && runtime[ln.id] || {};
        var col2 = !s ? 'var(--off)' : s.powerOff || s.gaveUp ? 'var(--bad)' : !s.connected ? 'var(--off)' : s.totalKw > 0 ? 'var(--chg)' : 'var(--av)';
        var g = el('g', { class: 'pnode', 'data-ci': ci, tabindex: 0, role: 'button', 'aria-label': cfg.chargers[ci].name }, svg);
        el('rect', { x: r2(p[0] - 1.2 * U), y: r2(p[1] - 0.8 * U), width: r2(2.4 * U), height: r2(1.6 * U), rx: r2(0.35 * U), fill: col2, class: 'post' + (selLine && ln && ln.id === selLine ? ' insel' : '') }, g);
        var amps = !s ? 0 : s.connectors.reduce(function (acc, k) { return acc + (k.powerKw || 0) * ampsPerKw(cfg.chargers[ci].kw, k.car && k.car.phases, cfg.phases); }, 0);
        var txt = !s ? '' : s.powerOff ? '⚡ 0 A' : s.totalKw > 0 ? fmt(amps, 1) + ' A' : '';
        var below = p[1] < (vb.y + vb.h / 2);
        el('text', { x: p[0], y: r2(p[1] + (below ? 2.3 : -1.6) * U), 'text-anchor': 'middle', 'font-size': r2(1.1 * U), class: 'clab' }, svg).textContent =
          cfg.chargers[ci].name + (ln ? ' · ' + ln.id : '');
        if (txt) el('text', { x: p[0], y: r2(p[1] + (below ? 3.5 : -2.8) * U), 'text-anchor': 'middle', 'font-size': r2(1.05 * U), class: 'clab soft' }, svg).textContent = txt;
      }
      hint();
    }

    function arrowIn(en, parent, cls) {
      var t0 = [en.c[0] + en.n[0] * 0.6, en.c[1] + en.n[1] * 0.6], t1 = [en.c[0] + en.n[0] * 3, en.c[1] + en.n[1] * 3], hw = 0.7;
      el('polyline', { points: [t0, t1].map(function (q) { return r2(q[0]) + ',' + r2(q[1]); }).join(' '), class: cls }, parent);
      el('polyline', { points: [[t1[0] - en.n[0] * 0.9 + en.u[0] * hw, t1[1] - en.n[1] * 0.9 + en.u[1] * hw], t1, [t1[0] - en.n[0] * 0.9 - en.u[0] * hw, t1[1] - en.n[1] * 0.9 - en.u[1] * hw]]
        .map(function (q) { return r2(q[0]) + ',' + r2(q[1]); }).join(' '), class: cls }, parent);
    }
    function removeLine(id) {
      plan.lines = plan.lines.filter(function (l) { return l.id !== id; });
      if (selLine === id) selLine = plan.lines.length ? plan.lines[0].id : null;
      save(); draw(); sidePanel();
    }
    // What is under a point, by geometry: the drawing is rebuilt every second, so DOM targets are not reliable
    function rowBays(r) {
      var L = dist(r.a, r.b), ux = (r.b[0] - r.a[0]) / (L || 1), uy = (r.b[1] - r.a[1]) / (L || 1), sd = r.flip ? -1 : 1;
      return { ux: ux, uy: uy, nx: -uy * sd, ny: ux * sd, L: Math.floor(L / 2.5 + 1e-6) * 2.5 };
    }
    function handles() {
      if (!plan.board || drawing || (tool !== 'move' && tool !== 'line' && tool !== 'erase')) return [];
      var l = plan.lines.filter(function (x) { return x.id === selLine; })[0]; if (!l) return [];
      var route = [plan.board].concat(l.pts), out = [];
      l.pts.forEach(function (q, i) { out.push({ kind: 'vertex', id: l.id, i: i, p: q }); });
      if (tool !== 'erase') for (var i = 1; i < route.length; i++) {
        out.push({ kind: 'mid', id: l.id, i: i - 1, p: [(route[i - 1][0] + route[i][0]) / 2, (route[i - 1][1] + route[i][1]) / 2] });
      }
      return out;
    }
    function hitTest(p) {
      var hs = handles(), vtx = null;
      for (var hi = 0; hi < hs.length; hi++) if (hs[hi].kind === 'vertex' && dist(hs[hi].p, p) < 1.1 * U) { vtx = hs[hi]; break; }
      // Inside a charger's or the board's box it is always that box (a cable's corner sitting on it can still be dragged in the Line tool)
      var m = 0.3 * U;
      for (var ci = 0; ci < nChargers(); ci++) {
        var q = plan.posts[ci];
        if (q && Math.abs(p[0] - q[0]) <= 1.2 * U + m && Math.abs(p[1] - q[1]) <= 0.8 * U + m) return { kind: 'charger', ci: ci, vertex: vtx };
      }
      if (plan.board && Math.abs(p[0] - plan.board[0]) <= 1.1 * U + m && Math.abs(p[1] - plan.board[1]) <= 1.1 * U + m) return { kind: 'board', vertex: vtx };
      if (vtx) return vtx;
      for (hi = 0; hi < hs.length; hi++) if (hs[hi].kind === 'mid' && dist(hs[hi].p, p) < 0.9 * U) return hs[hi];
      // Near a box but outside it: the closest of chargers, board and cables
      var tol = 1.6 * U, best = null, bd = Infinity;
      for (ci = 0; ci < nChargers(); ci++) { q = plan.posts[ci]; if (q && dist(q, p) < tol && dist(q, p) < bd) { bd = dist(q, p); best = { kind: 'charger', ci: ci }; } }
      if (plan.board && dist(plan.board, p) < tol && dist(plan.board, p) < bd) { bd = dist(plan.board, p); best = { kind: 'board' }; }
      if (plan.board) for (var i = plan.lines.length - 1; i >= 0; i--) {
        var pr = project([plan.board].concat(plan.lines[i].pts), p);
        if (pr.d < 0.9 * U && pr.d < bd) { bd = pr.d; best = { kind: 'line', id: plan.lines[i].id }; }
      }
      if (best) return best;
      var en = entrance(); if (en && dist(en.c, p) < Math.max(en.w / 2, 1.5 * U)) return { kind: 'door' };
      for (var ri = plan.rows.length - 1; ri >= 0; ri--) {
        var g = rowBays(plan.rows[ri]), dx = p[0] - plan.rows[ri].a[0], dy = p[1] - plan.rows[ri].a[1];
        var along = dx * g.ux + dy * g.uy, across = dx * g.nx + dy * g.ny;
        if (along >= 0 && along <= g.L && across >= 0 && across <= 5) return { kind: 'row', ri: ri };
      }
      return null;
    }
    function nextLineId() { var i = 1; while (plan.lines.some(function (l) { return l.id === 'L' + i; })) i++; return 'L' + i; }
    function finishLine(keep) {
      if (drawing && drawing.kind === 'line' && keep !== false && (drawing.pts.length || drawing.chargers.length)) {
        var id = nextLineId();
        drawing.chargers.forEach(function (ci) { plan.lines.forEach(function (l) { l.chargers = l.chargers.filter(function (x) { return x !== ci; }); }); });
        plan.lines.push({ id: id, amps: 32, mm2: 6, pts: drawing.pts, chargers: drawing.chargers });
        selLine = id; save();
      }
      drawing = null; draw(); sidePanel();
    }
    function toggleCharger(ci) {
      var l = plan.lines.filter(function (x) { return x.id === selLine; })[0]; if (!l) return;
      if (l.chargers.indexOf(ci) >= 0) l.chargers = l.chargers.filter(function (x) { return x !== ci; });
      else { plan.lines.forEach(function (x) { x.chargers = x.chargers.filter(function (y) { return y !== ci; }); }); l.chargers.push(ci); }
      save(); draw(); sidePanel();
    }
    function carFor(ci) {
      if (!site.running()) return;
      var post = site.live()[ci], bays = site.bays(); if (!post) return;
      for (var h = 1; h <= cfg.chargers[ci].hoses; h++) if (!bays[ci + ':' + h]) { site.arrive(ci, h); return; }
      var car = bays[ci + ':1']; if (car) site.leave(car);
    }

    var down = null, lastTap = null;
    svg.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var p = toM(ev);
      down = { p: p, hit: hitTest(p), x: ev.clientX, y: ev.clientY, moved: false };
      svg.setPointerCapture(ev.pointerId);
      if (tool === 'rows' && !down.hit) drawing = { kind: 'row', a: snapFrom(null, p) };
    });
    svg.addEventListener('pointermove', function (ev) {
      var p = toM(ev);
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) down.moved = true;
      if (down && down.moved && tool === 'line' && down.hit && down.hit.vertex) down.hit = down.hit.vertex;
      if (down && down.moved && (tool === 'move' || tool === 'line') && down.hit && (down.hit.kind === 'vertex' || down.hit.kind === 'mid')) {
        var ln = plan.lines.filter(function (x) { return x.id === down.hit.id; })[0];
        if (ln) {
          if (down.hit.kind === 'mid') { ln.pts.splice(down.hit.i, 0, down.hit.p.slice()); down.hit = { kind: 'vertex', id: ln.id, i: down.hit.i }; }
          var k = down.hit.i, prev = k === 0 ? plan.board : ln.pts[k - 1], next = ln.pts[k + 1];
          var q2 = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
          // Square to its neighbours when close: cables run along walls and trays
          [prev, next].forEach(function (nb) { if (!nb) return; if (Math.abs(q2[0] - nb[0]) < 0.8 * U) q2[0] = nb[0]; if (Math.abs(q2[1] - nb[1]) < 0.8 * U) q2[1] = nb[1]; });
          ln.pts[k] = q2; drag = true; draw();
        }
        return;
      }
      if (down && down.moved && tool === 'move' && down.hit && (down.hit.kind === 'board' || down.hit.kind === 'charger')) {
        drag = true; var q = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
        if (down.hit.kind === 'board') plan.board = q; else plan.posts[down.hit.ci] = q;
        draw(); return;
      }
      if (drawing && drawing.kind === 'row' && down) { drawing.b = snapFrom(drawing.a, p); draw(); return; }
      if (drawing && drawing.kind === 'line') { drawing.hover = snapFrom(drawing.pts.length ? drawing.pts[drawing.pts.length - 1] : plan.board, p); draw(); return; }
      if (tool === 'outline' && plan.outline.tramos.length && !plan.outline.closed) {
        var op = outlinePoints(plan.outline); drawing = { kind: 'outline', hover: snapFrom(op[op.length - 1], p) }; draw();
      }
    });
    svg.addEventListener('pointerup', function (ev) {
      if (!down) return;
      var d = down; down = null;
      if (drag) { drag = null; save(); draw(); sidePanel(); return; }
      if (drawing && drawing.kind === 'row') {
        var rw = drawing; drawing = null;
        if (rw.b && dist(rw.a, rw.b) >= 2.5) { plan.rows.push({ a: rw.a, b: rw.b }); save(); }
        draw(); if (d.moved) return;
      }
      if (d.moved) return;
      var now = Date.now(), dbl = lastTap && now - lastTap.t < 400 && dist(lastTap.p, d.p) < U;
      lastTap = { t: now, p: d.p };
      tap(d.p, d.hit, dbl);
    });
    function tap(p, hit, dbl) {
      if (hit && (hit.kind === 'vertex' || hit.kind === 'mid') && tool !== 'erase') return;
      if (tool === 'move') {
        if (hit && hit.kind === 'charger') carFor(hit.ci);
        else if (hit && hit.kind === 'line') { selLine = hit.id; draw(); sidePanel(); }
        return;
      }
      if (tool === 'outline') {
        var o = plan.outline;
        if (o.closed) return;
        var op = outlinePoints(o);
        if (!o.started && !o.tramos.length) { var s0 = snapFrom(null, p); o.x0 = s0[0]; o.y0 = s0[1]; o.h0 = 0; o.started = true; }
        else {
          var first = op[0], q = snapFrom(op[op.length - 1], p);
          if (o.tramos.length >= 2 && (dist(q, first) < 1.5 * U || dist(p, first) < 1.5 * U)) { outlineAdd(o, first); o.closed = true; drawing = null; }
          else outlineAdd(o, q);
        }
        save(); draw(); tramosPanel(); return;
      }
      if (tool === 'rows') { if (hit && hit.kind === 'line') { selLine = hit.id; draw(); sidePanel(); return; } if (hit && hit.kind === 'row') { plan.rows[hit.ri].flip = !plan.rows[hit.ri].flip; save(); draw(); } return; }
      if (tool === 'door') {
        var wn = wallNearest(p);
        if (wn) { plan.entrance = { wi: wn.wi, s: r2(wn.s), w: (plan.entrance && plan.entrance.w) || 4 }; save(); draw(); }
        return;
      }
      if (tool === 'board') { plan.board = snapFrom(null, p); save(); draw(); sidePanel(); return; }
      if (tool === 'charger') {
        var u = unplaced(); if (u.length) { plan.posts[u[0]] = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; save(); draw(); sidePanel(); }
        return;
      }
      if (tool === 'erase') {
        if (!hit) return;
        if (hit.kind === 'door') plan.entrance = null;
        else if (hit.kind === 'board') plan.board = null;
        else if (hit.kind === 'charger') { delete plan.posts[hit.ci]; plan.lines.forEach(function (l) { l.chargers = l.chargers.filter(function (x) { return x !== hit.ci; }); }); }
        else if (hit.kind === 'line') { removeLine(hit.id); return; }
        else if (hit.kind === 'vertex') { var lv = plan.lines.filter(function (x) { return x.id === hit.id; })[0]; if (lv) lv.pts.splice(hit.i, 1); }
        else if (hit.kind === 'row') plan.rows.splice(hit.ri, 1);
        save(); draw(); sidePanel(); return;
      }
      if (tool === 'line') {
        if (!plan.board) return;
        if (hit && hit.kind === 'charger') {
          if (drawing && drawing.kind === 'line') {
            var i = drawing.chargers.indexOf(hit.ci);
            if (i >= 0) drawing.chargers.splice(i, 1); else drawing.chargers.push(hit.ci);
            draw();
          } else toggleCharger(hit.ci);
          return;
        }
        if (!drawing || drawing.kind !== 'line') {
          if (hit && hit.kind === 'line') { selLine = hit.id; draw(); sidePanel(); return; }
          drawing = { kind: 'line', pts: [], chargers: [] };
        }
        if (dbl) { finishLine(true); return; }
        drawing.pts.push(snapFrom(drawing.pts.length ? drawing.pts[drawing.pts.length - 1] : plan.board, p));
        draw();
      }
    }
    doc.addEventListener('keydown', function (ev) {
      if (view !== 'plan' || !drawing) return;
      if (ev.key === 'Enter' && drawing.kind === 'line') { ev.preventDefault(); finishLine(true); }
      if (ev.key === 'Escape') { drawing = null; draw(); }
    });
    $('b-finish').textContent = T.finish; $('b-finish').onclick = function () { finishLine(true); };
    $('b-cancel-line').textContent = T.cancelLine; $('b-cancel-line').onclick = function () { finishLine(false); };

    // ── The outline, stretch by stretch ──
    function tramosPanel() {
      var o = plan.outline, box = $('tramos');
      var turns = [[90, T.right], [-90, T.left], [0, T.straight], [45, T.r45], [-45, T.l45], [135, T.r135], [-135, T.l135]];
      var html = '<div class="ttl">' + T.tramos + '</div>';
      if (!o.tramos.length) html += '<div class="small">' + (o.started ? T.hOutline : T.none) + '</div>';
      else {
        html += '<ol class="tramos">' + o.tramos.map(function (s, i) {
          var last = i === o.tramos.length - 1, known = turns.some(function (x) { return x[0] === s.t; });
          var opts = turns.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.t ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') +
                     (known ? '' : '<option value="' + s.t + '" selected>' + fmt(s.t, 1) + '°</option>');
          return '<li><input type="number" min="0.05" step="0.05" value="' + s.l + '" data-i="' + i + '" class="tl" aria-label="' + T.len + '"> ' + T.len +
                 (last && o.closed ? '' : ' · ' + T.turn + ' <select data-i="' + i + '" class="tt">' + opts + '</select>') + '</li>';
        }).join('') + '</ol>';
        var gap = closureGap(o);
        html += !o.closed ? '<div class="small">' + T.open + '</div>'
          : gap && gap.d < 0.05 ? '<div class="okc">' + T.closes + '</div>'
          : '<div class="trip">' + t('gap', { d: fmt(gap.d, 2), dx: fmt(gap.dx, 2), dy: fmt(gap.dy, 2) }) + '</div>';
      }
      html += '<div class="row-b"><button type="button" id="b-clear-outline">' + T.clearOutline + '</button></div>';
      box.innerHTML = html;
      Array.prototype.forEach.call(box.querySelectorAll('.tl'), function (inp) {
        inp.onchange = function () { var v = parseFloat(inp.value); if (v > 0) { o.tramos[+inp.dataset.i].l = r2(v); save(); draw(); tramosPanel(); } };
      });
      Array.prototype.forEach.call(box.querySelectorAll('.tt'), function (sel) {
        sel.onchange = function () { o.tramos[+sel.dataset.i].t = parseFloat(sel.value); save(); draw(); tramosPanel(); };
      });
      $('b-clear-outline').onclick = function () { plan.outline = { x0: 0, y0: 0, h0: 0, tramos: [], closed: false }; save(); setTool('outline'); tramosPanel(); };
    }

    // ── Side panel: one block per cable ──
    function sidePanel() {
      if (view !== 'plan') return;
      var res = calcAll(), box = $('lines-list'), now = Date.now(), on = site.running();
      $('lines-ttl').textContent = T.lines;
      if (!plan.lines.length) { box.innerHTML = '<div class="small">' + T.noLines + '</div>'; return; }
      box.innerHTML = plan.lines.map(function (l) {
        var r = res[l.id], rt = runtime[l.id] || {};
        var names = l.chargers.filter(function (ci) { return ci < nChargers(); }).map(function (ci) { return esc(cfg.chargers[ci].name); }).join(', ') || T.noChargers;
        var state = rt.tripUntil > now ? '<div class="trip">' + t('tripped', { n: l.id, s: Math.ceil((rt.tripUntil - now) / 1000) }) + '</div>'
          : rt.overSince ? '<div class="trip">' + t('tripIn', { n: l.id, s: Math.max(0, Math.ceil((rt.overSince + cfg.trip * 1000 - now) / 1000)) }) + '</div>'
          : r && r.amps > l.amps + 0.05 ? '<div class="trip">' + t(on ? 'over' : 'overFull', { a: l.amps }) + '</div>' : '';
        var has = r && r.taps.length;
        var load = r ? Math.min(100, r.amps / l.amps * 100) : 0;
        return '<div class="lnb' + (l.id === selLine ? ' sel' : '') + '" data-id="' + l.id + '">' +
          '<div class="lnh"><b>' + l.id + '</b><span class="pill" style="background:' + (has ? stateColor(r.pct) : 'var(--off)') + '">ΔU ' + (has ? fmt(r.pct, 2) : '–') + ' %</span></div>' +
          '<div class="f2"><div><label>' + T.breaker + '</label><select data-k="amps">' + BREAKERS.map(function (a) { return '<option' + (a === l.amps ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div>' +
          '<div><label>' + T.section + '</label><select data-k="mm2">' + SECTIONS.map(function (s) { return '<option value="' + s + '"' + (s === l.mm2 ? ' selected' : '') + '>' + fmt(s, s % 1 ? 1 : 0) + '</option>'; }).join('') + '</select></div></div>' +
          (r ? '<div class="nums"><div><span>' + T.length + '</span>' + fmt(r.length, 1) + ' m</div><div><span>' + T.current + ' (' + (on ? T.live : T.full) + ')</span>' + fmt(r.amps, 1) + ' / ' + l.amps + ' A</div><div><span>' + T.drop + '</span>' + fmt(r.v, 1) + ' V</div></div>' +
               '<div class="meter"><i style="width:' + load + '%;background:' + (r.amps > l.amps + 0.05 ? 'var(--bad)' : load > 85 ? 'var(--wait)' : 'var(--av)') + '"></i></div>' : '') +
          '<div class="small">' + names + ' · ' + t('limit', { p: DROP_LIMIT }) + ' · <a href="#" data-del="' + l.id + '">' + T.del + '</a></div>' + state + '</div>';
      }).join('') + (cfg.sb ? '<div class="small">' + T.sbLines + '</div>' : '');
      Array.prototype.forEach.call(box.querySelectorAll('.lnb'), function (d) {
        var l = plan.lines.filter(function (x) { return x.id === d.dataset.id; })[0];
        d.onclick = function (e) { if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION' || e.target.dataset.del) return; selLine = l.id; draw(); sidePanel(); };
        Array.prototype.forEach.call(d.querySelectorAll('select'), function (s) {
          s.onchange = function () { l[s.dataset.k] = parseFloat(s.value); save(); draw(); sidePanel(); };
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (a) { a.onclick = function (e) { e.preventDefault(); removeLine(a.dataset.del); }; });
    }

    // ── Save / load / sample ──
    $('b-plan-save').textContent = T.save; $('b-plan-load').textContent = T.load; $('b-plan-reset').textContent = T.reset;
    $('b-plan-save').onclick = function () {
      var out = { format: 'ocpp-virtual-charger/plan', version: 1, units: 'm', supply: { phases: cfg.phases, mainFuseA: cfg.amps, lgaKw: cfg.grid },
                  chargers: cfg.chargers.slice(0, nChargers()).map(function (c, i) { return { name: c.name, kw: c.kw, hoses: c.hoses, maxKw: c.max, at: plan.posts[i] || null }; }),
                  outline: plan.outline, outlinePoints: outlinePoints(plan.outline), rows: plan.rows, board: plan.board,
                  lines: plan.lines.map(function (l) { return { id: l.id, breakerA: l.amps, sectionMm2: l.mm2, route: [plan.board].concat(l.pts), chargers: l.chargers.map(function (ci) { return cfg.chargers[ci] ? cfg.chargers[ci].name : ci; }) }; }) };
      var a = doc.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      a.download = 'plan.json'; doc.body.appendChild(a); a.click(); a.remove();
    };
    $('b-plan-load').onclick = function () { $('plan-file').click(); };
    $('plan-file').onchange = function () {
      var f = $('plan-file').files[0]; if (!f) return;
      f.text().then(function (txt) {
        var d = JSON.parse(txt);
        if (d.format !== 'ocpp-virtual-charger/plan' || !d.outline) throw new Error('format');
        var byName = {}; cfg.chargers.forEach(function (c, i) { byName[c.name] = i; });
        var posts = {}; (d.chargers || []).forEach(function (c, i) { if (c.at && i < cfg.chargers.length) posts[i] = c.at; });
        plan = cfg.plan = { outline: d.outline, rows: d.rows || [], board: d.board || null, posts: posts,
          lines: (d.lines || []).map(function (l) {
            return { id: l.id, amps: l.breakerA, mm2: l.sectionMm2, pts: (l.route || []).slice(1),
                     chargers: (l.chargers || []).map(function (n) { return typeof n === 'number' ? n : byName[n]; }).filter(function (x) { return x != null; }) };
          }) };
        selLine = plan.lines.length ? plan.lines[0].id : null; save(); draw(); tramosPanel(); sidePanel();
      }).catch(function () { $('plan-hint').textContent = T.bad; });
      $('plan-file').value = '';
    };
    // New car park: empty plan, straight to drawing the outline (asked inline: browsers silence confirm())
    $('b-plan-new').textContent = T.newP; $('new-q').textContent = T.newQ; $('b-new-yes').textContent = T.newYes; $('b-new-no').textContent = T.newNo;
    $('b-plan-new').onclick = function () { $('new-confirm').hidden = false; $('b-plan-new').hidden = true; };
    $('b-new-no').onclick = function () { $('new-confirm').hidden = true; $('b-plan-new').hidden = false; };
    $('b-new-yes').onclick = function () {
      plan = cfg.plan = { outline: { x0: 0, y0: 0, h0: 0, tramos: [], closed: false }, rows: [], board: null, posts: {}, lines: [] };
      selLine = null; drawing = null; runtime = {}; save();
      $('new-confirm').hidden = true; $('b-plan-new').hidden = false;
      setTool('outline'); tramosPanel(); sidePanel();
      $('plan-view').scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    $('b-plan-reset').onclick = function () { plan = cfg.plan = defaultPlan(); selLine = 'L1'; save(); draw(); tramosPanel(); sidePanel(); };
    $('drop-note').textContent = T.dropNote;

    // ── The car park tab, drawn from the plan: the garage, its bays and the cars live ──
    // Each hose takes the nearest free bay to its charger (within 8 m), the way a driver would park.
    var parkSvg = $('park-plan');
    function bayList() {
      var out = [];
      plan.rows.forEach(function (r, ri) {
        var g = rowBays(r), n = Math.round(g.L / 2.5);
        for (var i = 0; i < n; i++) {
          var p0 = [r.a[0] + g.ux * 2.5 * i, r.a[1] + g.uy * 2.5 * i], p1 = [p0[0] + g.ux * 2.5, p0[1] + g.uy * 2.5];
          out.push({ key: ri + ':' + i, c: [p0[0] + g.ux * 1.25 + g.nx * 2.5, p0[1] + g.uy * 1.25 + g.ny * 2.5], n: [g.nx, g.ny],
                     q: [p0, p1, [p1[0] + g.nx * 5, p1[1] + g.ny * 5], [p0[0] + g.nx * 5, p0[1] + g.ny * 5]] });
        }
      });
      return out;
    }
    function hoseBays() {
      var bays = bayList(), taken = {}, out = {};
      for (var ci = 0; ci < nChargers(); ci++) {
        var post = plan.posts[ci]; if (!post) continue;
        var near = bays.filter(function (b) { return !taken[b.key] && dist(b.c, post) < 8; })
                       .sort(function (a, b) { return dist(a.c, post) - dist(b.c, post); });
        for (var h = 1; h <= cfg.chargers[ci].hoses; h++) {
          var b = near.shift();
          if (b) { taken[b.key] = true; out[ci + ':' + h] = b; continue; }
          // No bay drawn near it: a bay of its own next to the charger, facing the middle of the garage
          // Square to the nearest wall, facing inwards (towards the middle of the garage)
          var op = outlinePoints(plan.outline), cx = 0, cy = 0; op.forEach(function (q) { cx += q[0] / op.length; cy += q[1] / op.length; });
          var bestW = null, bdW = Infinity;
          for (var wi = 1; wi < op.length; wi++) { var pw = project([op[wi - 1], op[wi]], post); if (pw.d < bdW) { bdW = pw.d; bestW = [op[wi - 1], op[wi]]; } }
          var wl = bestW ? dist(bestW[0], bestW[1]) || 1 : 1, ux = bestW ? (bestW[1][0] - bestW[0][0]) / wl : 1, uy = bestW ? (bestW[1][1] - bestW[0][1]) / wl : 0;
          var nx = -uy, ny = ux; if ((cx - post[0]) * nx + (cy - post[1]) * ny < 0) { nx = -nx; ny = -ny; }
          var off = (h - (cfg.chargers[ci].hoses + 1) / 2) * 2.6;
          var c0 = [post[0] + nx * 3 + ux * off, post[1] + ny * 3 + uy * off];
          var q0 = [[c0[0] - ux * 1.25 - nx * 2.5, c0[1] - uy * 1.25 - ny * 2.5], [c0[0] + ux * 1.25 - nx * 2.5, c0[1] + uy * 1.25 - ny * 2.5],
                    [c0[0] + ux * 1.25 + nx * 2.5, c0[1] + uy * 1.25 + ny * 2.5], [c0[0] - ux * 1.25 + nx * 2.5, c0[1] - uy * 1.25 + ny * 2.5]];
          out[ci + ':' + h] = { key: 'v' + ci + ':' + h, c: c0, n: [nx, ny], q: q0, virtual: true };
        }
      }
      return { bays: bays, hose: out };
    }
    // Your plan is used as soon as its outline closes; whatever is missing is said, never silently swapped for the sample
    function planReady() { var g = closureGap(plan.outline); return !!(g && g.d < 0.05); }
    function parkNotice() {
      if (!plan.outline.tramos.length) return '';
      var g = closureGap(plan.outline);
      if (!plan.outline.closed) return T.nOpen;
      if (!g || g.d >= 0.05) return t('nGap', { d: fmt(g ? g.d : 0, 2) });
      var miss = [];
      if (!plan.rows.length) miss.push(T.nRows);
      if (!entrance()) miss.push(T.nDoor);
      var u = unplaced(); if (u.length) miss.push(t('nPosts', { n: u.map(function (i) { return cfg.chargers[i].name; }).join(', ') }));
      return miss.join(' · ');
    }
    var STATUS = { Available: 'var(--av)', Charging: 'var(--chg)', Preparing: 'var(--wait)', Finishing: 'var(--wait)', SuspendedEV: 'var(--wait)',
                   SuspendedEVSE: 'var(--wait)', Faulted: 'var(--bad)', Unavailable: 'var(--off)', Reserved: 'var(--in)' };
    var lastCut = false, parkCars = {};
    function pts2(a) { return a.map(function (q) { return r2(q[0]) + ',' + r2(q[1]); }).join(' '); }
    // Car seen from above, 4.4 × 1.8 m, nose to -y (same drawing as the sample car park, scaled to metres)
    function carShape2(color) {
      var g = doc.createElementNS(SVGNS, 'g'), s = el('g', { transform: 'scale(0.0333)' }, g);
      el('rect', { x: -27, y: -66, width: 54, height: 132, rx: 16, fill: color, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 2 }, s);
      el('path', { d: 'M-21 -36 Q0 -50 21 -36 L19 -18 L-19 -18 Z', fill: '#0f172a', opacity: .8 }, s);
      el('rect', { x: -19, y: -13, width: 38, height: 50, rx: 6, fill: 'rgba(0,0,0,.18)' }, s);
      el('path', { d: 'M-19 44 L19 44 L17 56 L-17 56 Z', fill: '#0f172a', opacity: .7 }, s);
      el('rect', { x: -14, y: 4, width: 28, height: 10, rx: 3, fill: 'rgba(15,23,42,.8)' }, s);
      el('rect', { x: -12, y: 6, width: 0, height: 6, rx: 2, fill: '#4ade80', class: 'soc' }, s);
      g.setAttribute('class', 'pcar2');
      return g;
    }
    function heading(d) { return Math.atan2(d[0], -d[1]) * 180 / Math.PI; }
    function putCar(pc, p, ang, ms) {
      pc.el.style.transition = ms ? 'transform ' + ms + 'ms cubic-bezier(.45,.05,.35,1)' : 'none';
      pc.el.style.transform = 'translate(' + r2(p[0]) + 'px,' + r2(p[1]) + 'px) rotate(' + r2(ang) + 'deg)';
      pc.at = p; pc.ang = ang;
    }
    // A car's trip: from outside the entrance, through it, to the lane in front of its bay, and nose in. Leaving, the reverse.
    function route(b, en) {
      var lane = [b.c[0] + b.n[0] * 5.2, b.c[1] + b.n[1] * 5.2];
      return { out: [en.c[0] - en.n[0] * 4, en.c[1] - en.n[1] * 4], door: [en.c[0] + en.n[0] * 3, en.c[1] + en.n[1] * 3], lane: lane, bay: b.c };
    }
    function moveCars(hb, en, gCars) {
      var cars = site.bays(), seen = {};
      Object.keys(cars).forEach(function (k) {
        var car = cars[k], b = hb.hose[k]; if (!b) return;
        seen[k] = true;
        var pc = parkCars[k];
        if (pc && pc.car !== car) { pc.el.remove(); pc = null; }
        var park = heading([-b.n[0], -b.n[1]]);
        if (!pc) {
          pc = parkCars[k] = { car: car, el: carShape2(car.model.color), state: 'new' };
          gCars.appendChild(pc.el);
          if (en && car.phase === 'in') {
            var r = route(b, en);
            putCar(pc, r.out, heading(en.n), 0);
            pc.el.getBoundingClientRect();
            pc.state = 'arriving';
            setTimeout(function () { putCar(pc, r.door, heading(en.n), 900); }, 30);
            setTimeout(function () { putCar(pc, r.lane, heading([r.lane[0] - r.door[0], r.lane[1] - r.door[1]]), 1400); }, 950);
            setTimeout(function () { putCar(pc, r.bay, park, 1300); pc.state = 'parked'; }, 2400);
          } else { putCar(pc, b.c, park, 0); pc.state = 'parked'; }
        } else if (gCars !== pc.el.parentNode) gCars.appendChild(pc.el);
        if (car.phase === 'out' && pc.state !== 'leaving') {
          pc.state = 'leaving';
          if (en) {
            var r2_ = route(b, en);
            putCar(pc, r2_.lane, park, 1300);
            setTimeout(function () { putCar(pc, r2_.door, heading([en.c[0] - r2_.lane[0], en.c[1] - r2_.lane[1]]), 1400); }, 1350);
            setTimeout(function () { putCar(pc, r2_.out, heading([-en.n[0], -en.n[1]]), 900); }, 2800);
            setTimeout(function () { pc.el.remove(); }, 3800);
          } else setTimeout(function () { pc.el.remove(); }, 1200);
        } else if (pc.state === 'parked' && (!pc.at || dist(pc.at, b.c) > 0.01)) putCar(pc, b.c, park, 0);   // the plan changed
        var live = site.live()[car.ci], c = live ? live.charger.state.connectors[car.hose - 1] : null, bar = pc.el.querySelector('.soc');
        if (bar && c && c.car && c.car.soc != null) bar.setAttribute('width', String(r2(24 * c.car.soc / 100)));
      });
      Object.keys(parkCars).forEach(function (k) { if (!seen[k] && parkCars[k].state !== 'leaving') { parkCars[k].el.remove(); delete parkCars[k]; } else if (!seen[k]) delete parkCars[k]; });
    }
    var gBase = null, gCarsP = null, gTop = null;
    function drawPark() {
      var ready = planReady();
      // SVG elements have no .hidden property: the attribute has to be set by hand
      $('park').toggleAttribute('hidden', ready); parkSvg.toggleAttribute('hidden', !ready); $('park-help').hidden = ready; $('park-plan-help').hidden = !ready;
      var nt = parkNotice(); $('park-notice').textContent = nt; $('park-notice').hidden = !nt;
      $('park-notice').className = ready ? 'small' : 'trip';   // missing bits are a hint; an outline that does not close is the reason
      if (!ready || view !== 'park') return;
      var keep = svg; svg = parkSvg; fit(); svg = keep;
      parkSvg.setAttribute('class', 'plan park2');
      if (!gBase || gBase.parentNode !== parkSvg) {
        parkSvg.innerHTML = '';
        gBase = el('g', {}, parkSvg); gCarsP = el('g', {}, parkSvg); gTop = el('g', {}, parkSvg); parkCars = {};
      }
      gBase.innerHTML = ''; gTop.innerHTML = '';
      var pts = outlinePoints(plan.outline), hb = hoseBays(), live = site.live(), cars = site.bays(), en = entrance(), now = Date.now();
      var res = plan.board ? calcAll() : {};
      // Floor and walls
      el('polygon', { points: pts2(pts), class: 'floor' }, gBase);
      if (en) {
        el('line', { x1: r2(en.a[0]), y1: r2(en.a[1]), x2: r2(en.b[0]), y2: r2(en.b[1]), class: 'door2' }, gBase);
        el('polygon', { points: pts2([en.a, en.b, [en.b[0] - en.n[0] * 3, en.b[1] - en.n[1] * 3], [en.a[0] - en.n[0] * 3, en.a[1] - en.n[1] * 3]]), class: 'ramp' }, gBase);
        arrowIn(en, gBase, 'doorarrow2');
        var lx = en.c[0] - en.n[0] * 4.2, ly = en.c[1] - en.n[1] * 4.2;
        el('text', { x: r2(lx), y: r2(ly + 0.4 * U), 'text-anchor': 'middle', 'font-size': r2(1.2 * U), class: 'plbl' }, gTop).textContent = T.inOut;
      }
      // Bays: painted side lines, and the EV marking in the colour of the hose's status
      var allBays = hb.bays.slice(); Object.keys(hb.hose).forEach(function (k) { if (hb.hose[k].virtual) allBays.push(hb.hose[k]); });
      allBays.forEach(function (b) { el('polyline', { points: pts2([b.q[3], b.q[0], b.q[1], b.q[2]]), class: 'bayline' }, gBase); });
      // Cables: the tray, then each cable with its current (thicker and moving when it carries current) and a tag with its amps
      var tags = [];
      plan.lines.forEach(function (l, li) {
        if (!plan.board) return;
        var r = res[l.id], off = (li - (plan.lines.length - 1) / 2) * 0.35, rt = runtime[l.id] || {}, cut = rt.tripUntil > now;
        var route2 = [plan.board].concat(l.pts).map(function (q) { return [q[0] + off, q[1] + off]; });
        el('polyline', { points: pts2(route2), class: 'tray2' }, gBase);
        var a = r ? r.amps : 0, col = cut ? 'var(--bad)' : a > l.amps + 0.05 ? 'var(--bad)' : a > 0.05 ? 'var(--chg)' : 'var(--off)';
        var w = a > 0.05 ? Math.min(7, 2 + a / 12) : 1.5;
        el('polyline', { points: pts2(route2), class: 'cab2' + (a > 0.05 && !cut ? ' flow' : ''), stroke: col, 'stroke-width': r2(w) }, gBase);
        if (r) r.taps.forEach(function (tp) {
          el('line', { x1: r2(tp.at[0] + off), y1: r2(tp.at[1] + off), x2: plan.posts[tp.ci][0], y2: plan.posts[tp.ci][1], class: 'cab2' + (tp.I > 0.05 && !cut ? ' flow' : ''), stroke: col, 'stroke-width': r2(tp.I > 0.05 ? Math.min(5, 1.5 + tp.I / 12) : 1.2) }, gBase);
        });
        // The tag goes on the cable, on the longest stretches first, where it does not cover another cable's tag
        var tag = l.id + ' · ' + (cut ? T.tripShort : fmt(a, 1) + ' / ' + l.amps + ' A');
        var tw = tag.length * 0.62 * U + 1.2 * U, th = 1.9 * U, cand = [];
        for (var i = 1; i < route2.length; i++) {
          var d = dist(route2[i - 1], route2[i]);
          [0.5, 0.3, 0.7, 0.15, 0.85].forEach(function (f, fi) { cand.push({ k: d * (1 - fi * 0.08), p: [route2[i - 1][0] + (route2[i][0] - route2[i - 1][0]) * f, route2[i - 1][1] + (route2[i][1] - route2[i - 1][1]) * f] }); });
        }
        cand.sort(function (x, y) { return y.k - x.k; });
        var clear = function (q) { return tags.every(function (o) { return Math.abs(o[0] - q[0]) > (o[2] + tw) / 2 + 0.2 || Math.abs(o[1] - q[1]) > th + 0.1; }); };
        var m = (cand.filter(function (c0) { return clear(c0.p); })[0] || cand[0] || { p: plan.board }).p;
        tags.push([m[0], m[1], tw]);
        el('rect', { x: r2(m[0] - tw / 2), y: r2(m[1] - 0.95 * U), width: r2(tw), height: r2(1.9 * U), rx: r2(0.5 * U), class: 'atag', fill: col }, gTop);
        el('text', { x: r2(m[0]), y: r2(m[1] + 0.42 * U), 'text-anchor': 'middle', 'font-size': r2(1.15 * U), class: 'atagt' }, gTop).textContent = tag;
      });
      // Main board where the LGA comes in, its breaker and the SB when there is one
      if (plan.board) {
        var wn = wallNearest(plan.board), op = outlinePoints(plan.outline);
        if (wn) {
          var wa = op[wn.wi], wb = op[wn.wi + 1], wl = dist(wa, wb) || 1, wpt = [wa[0] + (wb[0] - wa[0]) * wn.s / wl, wa[1] + (wb[1] - wa[1]) * wn.s / wl];
          var vx = wpt[0] - plan.board[0], vy = wpt[1] - plan.board[1], vl = Math.hypot(vx, vy);
          var ox = vl > 0.01 ? vx / vl : -(wb[1] - wa[1]) / wl, oy = vl > 0.01 ? vy / vl : (wb[0] - wa[0]) / wl;
          if (inside([wpt[0] + ox * 0.5, wpt[1] + oy * 0.5], op)) { ox = -ox; oy = -oy; }
          var street = [wpt[0] + ox * 3, wpt[1] + oy * 3], chg = live.reduce(function (s2, p2) { return s2 + (p2 ? p2.charger.state.totalKw || 0 : 0); }, 0);
          el('polyline', { points: pts2([plan.board, wpt, street]), class: 'lga2' }, gBase);
          el('polyline', { points: pts2([street, wpt, plan.board]), class: 'cab2' + (chg > 0.05 && !lastCut ? ' flow' : ''), stroke: 'var(--wait)', 'stroke-width': r2(chg > 0.05 ? Math.min(8, 2 + chg / 6) : 1.5) }, gBase);
          el('text', { x: r2(street[0] + ox * 0.8 * U), y: r2(street[1] + oy * 0.8 * U + 0.4 * U), 'text-anchor': ox > 0.5 ? 'start' : ox < -0.5 ? 'end' : 'middle', 'font-size': r2(1.15 * U), class: 'plbl' }, gTop)
            .textContent = 'LGA ' + (cfg.phases === 3 ? '3×' : '1×') + cfg.amps + ' A · ' + fmt(cfg.grid, 1) + ' kW';
        }
        var cg = el('g', { class: 'cg2' }, gTop);
        el('rect', { x: r2(plan.board[0] - 0.9), y: r2(plan.board[1] - 0.9), width: 1.8, height: 1.8, rx: 0.25, fill: '#1e293b', stroke: '#0b1220', 'stroke-width': 0.08 }, cg);
        el('circle', { cx: plan.board[0], cy: r2(plan.board[1] - 0.25), r: 0.4, fill: lastCut ? 'var(--bad)' : 'var(--av)' }, cg);
        el('text', { x: plan.board[0], y: r2(plan.board[1] + 0.65), 'text-anchor': 'middle', 'font-size': 0.6, class: 'boardtxt' }, cg).textContent = 'CG';
        if (cfg.sb) {
          el('rect', { x: r2(plan.board[0] + 1.1), y: r2(plan.board[1] - 0.9), width: 1.8, height: 1.8, rx: 0.25, fill: '#7c3aed', stroke: '#0b1220', 'stroke-width': 0.08 }, cg);
          el('text', { x: r2(plan.board[0] + 2), y: r2(plan.board[1] + 0.25), 'text-anchor': 'middle', 'font-size': 0.7, class: 'boardtxt' }, cg).textContent = 'SB';
        }
      }
      // Chargers and hoses
      for (var ci = 0; ci < nChargers(); ci++) {
        var post = plan.posts[ci]; if (!post) continue;
        var s = live[ci] ? live[ci].charger.state : null;
        for (var h = 1; h <= cfg.chargers[ci].hoses; h++) {
          var b = hb.hose[ci + ':' + h], c = s ? s.connectors[h - 1] : null, car = cars[ci + ':' + h];
          var st = !s || !s.connected || s.powerOff ? null : c && c.status;
          if (!b) continue;
          var mk = [b.c[0] + b.n[0] * 1.7, b.c[1] + b.n[1] * 1.7], ux = -b.n[1], uy = b.n[0];
          el('polygon', { points: pts2([[mk[0] - ux * 0.8 - b.n[0] * 0.35, mk[1] - uy * 0.8 - b.n[1] * 0.35], [mk[0] + ux * 0.8 - b.n[0] * 0.35, mk[1] + uy * 0.8 - b.n[1] * 0.35],
                                         [mk[0] + ux * 0.8 + b.n[0] * 0.35, mk[1] + uy * 0.8 + b.n[1] * 0.35], [mk[0] - ux * 0.8 + b.n[0] * 0.35, mk[1] - uy * 0.8 + b.n[1] * 0.35]]),
                        class: 'mark2', fill: st ? STATUS[st] || 'var(--off)' : 'var(--off)' }, gBase);
          var pc = parkCars[ci + ':' + h];
          if (car && car.phase === 'parked' && c && c.plugged && pc && pc.state === 'parked')
            el('line', { x1: post[0], y1: post[1], x2: r2(b.c[0] - b.n[0] * 1.6), y2: r2(b.c[1] - b.n[1] * 1.6), class: 'hose2' + (c.powerKw > 0 ? ' flow' : ''), stroke: STATUS[c.status] || 'var(--off)' }, gTop);
          var l1 = c && c.powerKw > 0 ? fmt(c.powerKw, 1) + ' kW' : c && c.status === 'SuspendedEV' ? (ES ? 'lleno' : 'full') : c && c.status === 'SuspendedEVSE' ? (ES ? 'pausa' : 'paused') : '';
          var l2 = c && c.car && (c.powerKw > 0 || c.status === 'SuspendedEV') ? Math.floor(c.car.soc) + ' %' : '';
          if (l1 && pc && pc.state === 'parked') {
            var tx = el('text', { x: r2(b.c[0]), y: r2(b.c[1] - 0.15 * U), 'text-anchor': 'middle', 'font-size': r2(0.8 * U), class: 'plbl' }, gTop);
            tx.textContent = l1;
            if (l2) el('text', { x: r2(b.c[0]), y: r2(b.c[1] + 0.9 * U), 'text-anchor': 'middle', 'font-size': r2(0.8 * U), class: 'plbl' }, gTop).textContent = l2;
          }
        }
        var col = !s ? 'var(--off)' : s.powerOff || s.gaveUp ? 'var(--bad)' : !s.connected ? 'var(--off)' : s.totalKw > 0 ? 'var(--chg)' : 'var(--av)';
        var pg = el('g', { class: 'ped2' }, gTop);
        el('rect', { x: r2(post[0] - 0.6), y: r2(post[1] - 0.45), width: 1.2, height: 0.9, rx: 0.18, fill: '#1e293b', stroke: '#0b1220', 'stroke-width': 0.06 }, pg);
        el('circle', { cx: post[0], cy: post[1], r: 0.24, fill: col, class: s && s.totalKw > 0 ? 'led-chg' : '' }, pg);
        var below = post[1] < (vb.y + vb.h / 2), kw = cfg.chargers[ci].kw;
        var y1 = below ? post[1] - 2.1 * U : post[1] + 1.9 * U, y2 = below ? post[1] - 1.0 * U : post[1] + 3.0 * U;
        el('text', { x: post[0], y: r2(y1), 'text-anchor': 'middle', 'font-size': r2(0.95 * U), class: 'plbl' }, gTop).textContent = cfg.chargers[ci].name;
        el('text', { x: post[0], y: r2(y2), 'text-anchor': 'middle', 'font-size': r2(0.85 * U), class: 'plbl soft' }, gTop).textContent = fmt(kw, kw % 1 ? 1 : 0) + ' kW';
      }
      moveCars(hb, en, gCarsP);
    }
    function parkHit(ev) {
      var pt = parkSvg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      var p = pt.matrixTransform(parkSvg.getScreenCTM().inverse()), q = [p.x, p.y], hb = hoseBays(), cars = site.bays();
      for (var ci = 0; ci < nChargers(); ci++) if (plan.posts[ci] && dist(plan.posts[ci], q) < 1.6 * U) { site.openDialog(ci); return; }
      if (plan.board && site.openLga && dist(plan.board, q) < 1.6 * U) { site.openLga(); return; }
      // Only the bay under the click (they are 2.5 m wide: one click must not reach the next one)
      var k = Object.keys(hb.hose).sort(function (x, y) { return dist(hb.hose[x].c, q) - dist(hb.hose[y].c, q); })[0];
      if (!k || dist(hb.hose[k].c, q) > 2.4) return;
      var car = cars[k], ci2 = +k.split(':')[0], h2 = +k.split(':')[1];
      if (car) site.leave(car); else if (site.running()) site.arrive(ci2, h2);
    }
    parkSvg.addEventListener('click', parkHit);

    // ── For site.js: the cables' limits for the SB, and every second, the breakers of the cables ──
    site.lineFor = function (ci) { var l = plan.board ? lineOf(ci) : null; return l ? l.id : null; };
    site.lineCaps = function () { var c = {}; plan.lines.forEach(function (l) { c[l.id] = l.amps; }); return c; };
    site.onTick = function (now, cut) {
      lastCut = !!cut;
      if (site.running() && plan.board) {
        var res = calcAll(), live = site.live();
        plan.lines.forEach(function (l) {
          var rt = runtime[l.id] = runtime[l.id] || {}, r = res[l.id];
          if (cut || rt.tripUntil > now || !r || !(cfg.trip > 0) || r.amps <= l.amps + 0.05) { rt.overSince = null; return; }
          rt.overSince = rt.overSince || now;
          if (now - rt.overSince >= cfg.trip * 1000) {
            rt.overSince = null; rt.tripUntil = now + 30000;
            l.chargers.forEach(function (ci) { if (live[ci]) live[ci].charger.powerLoss(30); });
          }
        });
      } else runtime = {};
      if (view === 'plan') { draw(); sidePanel(); } else drawPark();
    };
    site.onLayout = function () { if (view === 'plan') { draw(); sidePanel(); } else drawPark(); };

    setTool('move'); tramosPanel(); showView(view);
  }

  var api = { calc: calc, mount: mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OvcPlano = api;
})(typeof window !== 'undefined' ? window : globalThis);
