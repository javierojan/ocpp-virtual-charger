// The site page (site.html): a car park seen from above, with virtual OCPP chargers (ocpp-virtual-charger.js), a small
// building next to it and one grid connection (LGA) for both. Click a charger to name it and set its power; cars drive
// in, charge and leave. Everything that shapes the test is a setting on the page, kept in localStorage.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ES = /^es\b/i.test(navigator.language || '') || /[?&]lang=es\b/.test(location.search);
  var HOSTED = location.hostname === 'askacharge.com';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var TXT = ES ? {
    title: 'Simulador de instalación de carga OCPP',
    lead: 'Un parking visto desde arriba, con un edificio al lado y una sola acometida para los dos. Pincha en un cargador para ponerle nombre y potencia, enciende la instalación y mira cómo entran los coches, cargan y se van, mientras cada mensaje OCPP va a un servidor de verdad.',
    addrLbl: 'Dirección genérica (al final se añade el nombre de cada cargador)', gridKw: 'Potencia de la LGA (acometida)',
    arrivals: 'Llegan coches', arrNo: 'solo cuando los mando', arrBusy: 'a menudo', arrCalm: 'de vez en cuando',
    speed: 'Las baterías se llenan', real: 'a velocidad real', start: 'Encender la instalación', stopAll: 'Apagar',
    addrHelp: 'Desde el navegador los cargadores conectan sin contraseña (un navegador no puede mandar Basic Auth). ¿Sin CSMS?',
    useTest: 'Usar el servidor de pruebas gratuito de askacharge.com', watch: 'ver lo que recibe →',
    parkHelp: 'Pincha en un cargador para ponerle nombre y potencia · en una plaza libre para mandar un coche · en un coche para que se vaya.',
    parkPlanHelp: 'Tu parking de la pestaña Plano. Pincha en un cargador para ponerle nombre y potencia · en una plaza libre junto a un cargador para mandar un coche · en un coche para que se vaya.',
    draw: 'Consumo de la LGA', lgChg: 'cargadores', lgTot: 'con el edificio', lgLim: 'LGA', lgWin: '10 min', more: 'Más ajustes',
    baseKw: 'Edificio: consumo habitual (kW)', peaksLbl: 'Edificio: picos de consumo (ascensor, calefacción, cocina)',
    peaksSome: 'de vez en cuando', peaksMany: 'a menudo',
    tripLbl: 'Salta el general si se supera durante', never: 'Nunca', nChg: 'Cargadores en el parking',
    frames: 'Mensajes OCPP', all: 'Todos los cargadores', hideMeter: 'ocultar MeterValues y Heartbeat',
    promoT: '¿Tienes una instalación de verdad?', promoB: 'Prueba 30 días gratis',
    promoP: 'askacharge.com reparte la potencia de una instalación entre sus cargadores con OCPP estándar, con tus tarifas y tus cobros, y sin atarte a ningún fabricante. Pruébalo 30 días gratis, sin tarjeta.',
    simple: 'Un simulador, dicho claro: el OCPP es de verdad; la física está simplificada (curvas de carga de los coches, consumo del edificio). Solo se aceleran las baterías: el contador cuenta siempre la energía real.',
    single: 'Un solo cargador', madeby: 'Hecho por', video: '▶ Míralo en dos minutos: coches, balanceo de carga y el general saltando',
    nameLbl: 'Nombre (identidad OCPP)', kwLbl: 'Potencia por manguera', hosesLbl: 'Mangueras', maxLbl: 'El cargador entero, como mucho (kW)', phaseLbl: 'Fase si carga en monofásico',
    dlgNote: 'Si la instalación está encendida, solo se reconecta este cargador.', cancel: 'Cancelar', save: 'Guardar',
    charger: 'Cargador {n}', of: 'de {k} kW', over: 'Por encima de la LGA', ok: 'Dentro de la LGA',
    tripped: '⚡ Ha saltado el general: sin luz {s} s', tripIn: 'Salta el general en {s} s', building: 'edificio {k} kW',
    noUrl: 'Escribe la dirección genérica, acabada en /.', noCode: 'No se ha podido pedir un código al servidor de pruebas.',
    dupName: 'Ya hay un cargador con ese nombre.', online: 'conectado', offline: 'sin red', powerOff: 'sin luz', gaveUp: 'rechazado', connecting: 'conectando…', off: 'apagado',
    full: 'lleno', waiting: 'esperando tarjeta', paused: 'en pausa', bld: 'EDIFICIO', peak: 'pico', inn: 'ENTRADA →', outt: '← SALIDA',
    gridKw: 'LGA (acometida)', lgaTitle: 'LGA y cuadro general', phLbl: 'Suministro', tri: 'Trifásico 400 V', mono: 'Monofásico 230 V',
    ampLbl: 'Fusible general (A)', lgaKw: 'Potencia de la LGA: {k} kW', no: 'No', yes: 'Sí',
    sbLbl: 'Sistema de balanceo local (SB)', sbMarginLbl: 'Margen de seguridad del SB (%)',
    sbHelp: 'Un balanceador local mide la LGA y limita él mismo los cargadores, sin OCPP: lo que deja libre el edificio, menos el margen. Da a cada coche al menos su mínimo (6 A) por orden de llegada mientras quepa, y el resto a partes iguales; los que no caben esperan. Los perfiles de carga OCPP de la plataforma siguen aplicándose encima: manda el límite más bajo.',
    sbCap: 'SB ≤{k}'
  } : {
    charger: 'Charger {n}', of: 'of {k} kW', over: 'Above the LGA', ok: 'Within the LGA',
    tripped: '⚡ The main breaker tripped: no power for {s} s', tripIn: 'Main breaker trips in {s} s', building: 'building {k} kW',
    noUrl: 'Type the generic address, ending in /.', noCode: 'Could not get a code from the test server.',
    dupName: 'There is already a charger with that name.', online: 'online', offline: 'offline', powerOff: 'no power', gaveUp: 'rejected', connecting: 'connecting…', off: 'off',
    full: 'full', waiting: 'waiting for a card', paused: 'paused', all: 'All chargers', bld: 'BUILDING', peak: 'peak', inn: 'IN →', outt: '← OUT',
    lgaKw: 'LGA power: {k} kW', sbCap: 'SB ≤{k}'
  };
  function t(k, v) { var s = TXT[k] || k; Object.keys(v || {}).forEach(function (x) { s = s.replace('{' + x + '}', v[x]); }); return s; }
  if (ES) {
    document.documentElement.lang = 'es';
    document.title = 'Simulador de instalación de carga OCPP — un parking visto desde arriba';
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (e) { if (TXT[e.dataset.t]) e.textContent = TXT[e.dataset.t]; });
    $('video').href = 'https://youtu.be/YfNWk6Fw51U';
  }
  function fmt(n, d) { return Number(n || 0).toLocaleString(ES ? 'es-ES' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  // Cars: battery, what they accept, phases, and a colour for the drawing
  var CARS = [
    { batteryKwh: 40, maxAcKw: 7.4, maxDcKw: 50, phases: 1, color: '#ef4444' },
    { batteryKwh: 64, maxAcKw: 11, maxDcKw: 100, phases: 3, color: '#3b82f6' },
    { batteryKwh: 77, maxAcKw: 11, maxDcKw: 150, phases: 3, color: '#f8fafc' },
    { batteryKwh: 100, maxAcKw: 22, maxDcKw: 150, phases: 3, color: '#111827' },
    { batteryKwh: 58, maxAcKw: 11, maxDcKw: 120, phases: 3, color: '#f59e0b' },
    { batteryKwh: 75, maxAcKw: 22, maxDcKw: 80, phases: 3, color: '#10b981' }
  ];

  // ── Settings ────────────────────────────────────────────────────────────────────────────────────────
  var DEFAULT = { url: '', grid: 43.6, phases: 3, amps: 63, arr: 40, speed: 1, base: 6, peaks: 1, trip: 0, sb: 0, sbMargin: 10, n: 4, chargers: [], plan: null, view: 'park' };
  for (var i = 0; i < 6; i++) DEFAULT.chargers.push({ name: 'SITE-' + (i + 1), kw: i < 2 ? 11 : 22, hoses: 2, max: 22 });
  var cfg;
  try { cfg = JSON.parse(localStorage.getItem('ovc-parking') || 'null'); } catch (e) {}
  if (!cfg || !cfg.chargers) cfg = JSON.parse(JSON.stringify(DEFAULT));
  Object.keys(DEFAULT).forEach(function (k) { if (cfg[k] === undefined) cfg[k] = DEFAULT[k]; });
  function save() { try { localStorage.setItem('ovc-parking', JSON.stringify(cfg)); } catch (e) {} }
  function bind(id, key, num, after) {
    var e = $(id); e.value = String(cfg[key]);
    if (e.tagName === 'SELECT' && e.value !== String(cfg[key])) { cfg[key] = num ? parseFloat(e.options[0].value) : e.options[0].value; e.value = String(cfg[key]); }
    e.onchange = function () { cfg[key] = num ? parseFloat(e.value) || 0 : e.value.trim(); save(); if (after) after(); };
  }
  bind('c-url', 'url'); bind('c-arr', 'arr', true);
  // LGA power from its supply and main fuse: three-phase √3 × 400 V × A, single-phase 230 V × A
  function lgaKw(ph, a) { return Math.round((ph === 3 ? Math.sqrt(3) * 400 * a : 230 * a) / 100) / 10; }
  cfg.grid = lgaKw(cfg.phases, cfg.amps);
  function lgaButton() {
    $('b-lga').textContent = (cfg.phases === 3 ? '3×' : '1×') + cfg.amps + ' A · ' + fmt(cfg.grid, 1) + ' kW' + (cfg.sb ? ' · SB' : '');
    lgaLabel();
  }
  function openLga() {
    $('l-ph').value = String(cfg.phases); $('l-amps').value = String(cfg.amps); $('l-base').value = cfg.base;
    $('l-peaks').value = String(cfg.peaks); $('l-trip').value = String(cfg.trip); $('l-sb').value = String(cfg.sb); $('l-margin').value = cfg.sbMargin;
    lgaPreview(); $('dlg-lga').showModal();
  }
  function lgaPreview() { $('l-kw').textContent = t('lgaKw', { k: fmt(lgaKw(parseInt($('l-ph').value, 10), parseInt($('l-amps').value, 10)), 1) }); }
  $('l-ph').onchange = lgaPreview; $('l-amps').onchange = lgaPreview;
  $('b-lga').onclick = openLga;
  $('lga-form').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    cfg.phases = parseInt($('l-ph').value, 10); cfg.amps = parseInt($('l-amps').value, 10); cfg.grid = lgaKw(cfg.phases, cfg.amps);
    cfg.base = parseFloat($('l-base').value) || 0; cfg.peaks = parseInt($('l-peaks').value, 10); cfg.trip = parseInt($('l-trip').value, 10);
    cfg.sb = parseInt($('l-sb').value, 10); cfg.sbMargin = Math.max(0, Math.min(50, parseFloat($('l-margin').value) || 0));
    if (!cfg.sb) live.forEach(function (p, ci) { p.sbKw = null; p.charger.setChargerMax(cfg.chargers[ci].max); });
    save(); lgaButton(); paint();
  });
  bind('c-speed', 'speed', true, function () { live.forEach(function (c) { if (c) c.charger.setSocSpeed(cfg.speed); }); });
  bind('c-n', 'n', true, function () { if (!running) layout(); });
  $('b-test').hidden = !HOSTED;
  $('b-test').onclick = function (e) {
    e.preventDefault();
    fetch('/askacharge/ocpp-test/api/nuevo', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.codigo) throw new Error('no code');
      cfg.url = 'wss://askacharge.com/askacharge/ocpp-test/' + d.codigo + '/'; save(); $('c-url').value = cfg.url;
      var w = $('watch'); w.hidden = false;
      w.href = '/askacharge/' + (ES ? 'probar-ocpp.html' : 'en/ocpp-test-server.html') + '?c=' + d.codigo + '&src=virtual-site';
    }).catch(function () { $('msg').textContent = TXT.noCode; });
  };

  // ── The drawing ─────────────────────────────────────────────────────────────────────────────────────
  var BAY = 120, PED = 60, GAP = 24, M = 30, TOP = 92, DEPTH = 210, LANE = 405, H = 520, BW = 190;
  var geo = [], W = 1000;
  var svg = $('park'), gBays, gHoses, gCars, gLabels, windows = [];

  function lgaLabel() { var l = $('lga-txt'); if (l) l.textContent = 'LGA ' + (cfg.phases === 3 ? '3×' : '1×') + cfg.amps + ' A · ' + fmt(cfg.grid, 1) + ' kW'; }
  function layout() {
    var n = cfg.n, x = BW + M; geo = [];
    for (var ci = 0; ci < n; ci++) {
      var c = cfg.chargers[ci], g = { bays: [] };
      if (c.hoses === 2) {
        g.bays.push({ x: x, cx: x + BAY / 2 });
        g.ped = { x: x + BAY, cx: x + BAY + PED / 2 };
        g.bays.push({ x: x + BAY + PED, cx: x + BAY + PED + BAY / 2 });
        x += 2 * BAY + PED + GAP;
      } else {
        g.ped = { x: x, cx: x + PED / 2 };
        g.bays.push({ x: x + PED, cx: x + PED + BAY / 2 });
        x += BAY + PED + GAP;
      }
      geo.push(g);
    }
    W = Math.max(800, x - GAP + M);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '';
    // Asphalt, the lane and the way in and out
    el('rect', { x: BW, y: 30, width: W - BW, height: H - 60, fill: 'var(--asphalt)' }, svg);
    el('rect', { x: BW, y: LANE - 70, width: W - BW, height: 140, fill: 'var(--asphalt2)' }, svg);
    el('line', { x1: BW, x2: W, y1: LANE, y2: LANE, stroke: 'var(--paint)', 'stroke-width': 3, 'stroke-dasharray': '26 22', opacity: .7 }, svg);
    var arrow = function (ax) { el('path', { d: 'M' + ax + ' ' + (LANE + 34) + ' h-34 m12 -10 l-12 10 l12 10', stroke: 'var(--paint)', 'stroke-width': 4, fill: 'none', opacity: .6 }, svg); };
    arrow(W - 60); arrow(BW + 70);
    el('text', { x: W - 14, y: LANE + 70, 'text-anchor': 'end', class: 'lbl s' }, svg).textContent = TXT.inn;
    el('text', { x: BW + 14, y: LANE + 70, class: 'lbl s' }, svg).textContent = TXT.outt;
    // Kerb at the top of the bays, where the cable from the main board runs to every charger
    el('rect', { x: BW, y: 30, width: W - BW, height: TOP - 30, fill: 'var(--curb)' }, svg);
    el('line', { x1: BW - 20, x2: geo.length ? geo[geo.length - 1].ped.cx : BW, y1: 50, y2: 50, stroke: '#334155', 'stroke-width': 6, 'stroke-linecap': 'round' }, svg);
    el('line', { id: 'feed', x1: BW - 20, x2: geo.length ? geo[geo.length - 1].ped.cx : BW, y1: 50, y2: 50, class: 'hose flow', stroke: 'var(--chg)', 'stroke-width': 0 }, svg);
    // The building, seen from above: flat roof, windows that light up with its load, and its main board
    var b = el('g', {}, svg);
    el('rect', { x: 10, y: 30, width: BW - 30, height: H - 120, rx: 6, fill: '#cbd5e1', stroke: '#64748b', 'stroke-width': 3 }, b);
    el('rect', { x: 22, y: 42, width: BW - 54, height: H - 144, rx: 4, fill: '#94a3b8' }, b);
    windows = [];
    for (var r = 0; r < 6; r++) for (var k = 0; k < 3; k++) {
      windows.push(el('rect', { x: 36 + k * 40, y: 130 + r * 34, width: 26, height: 18, rx: 2, fill: '#475569' }, b));
    }
    el('text', { x: 10 + (BW - 30) / 2, y: 74, 'text-anchor': 'middle', class: 'lbl' }, b).textContent = TXT.bld;
    el('text', { x: 10 + (BW - 30) / 2, y: 100, 'text-anchor': 'middle', class: 'lbl', id: 'bld-kw' }, b).textContent = '';
    // Main board (CGP) on the facade, where the LGA comes in from the street
    var cgp = el('g', { class: 'pedestal' }, svg);
    el('rect', { class: 'body', x: BW - 44, y: 36, width: 30, height: 30, rx: 4, fill: '#1e293b', stroke: '#0b1220' }, cgp);
    el('circle', { id: 'breaker', cx: BW - 29, cy: 51, r: 6, fill: 'var(--av)' }, cgp);
    // Local load balancer next to the main board, when there is one
    var sbx = el('g', { id: 'sb-box' }, cgp);
    el('rect', { x: BW - 78, y: 36, width: 30, height: 30, rx: 4, fill: '#7c3aed', stroke: '#0b1220' }, sbx);
    el('text', { x: BW - 63, y: 56, 'text-anchor': 'middle', class: 'lbl s' }, sbx).textContent = 'SB';
    cgp.addEventListener('click', openLga);
    el('line', { x1: BW - 29, x2: BW - 29, y1: 0, y2: 36, stroke: '#334155', 'stroke-width': 7 }, svg);
    el('line', { id: 'lga', x1: BW - 29, x2: BW - 29, y1: 0, y2: 36, class: 'hose flow', stroke: 'var(--wait)', 'stroke-width': 0 }, svg);
    el('text', { x: BW - 8, y: 20, class: 'lbl s', id: 'lga-txt' }, svg);
    lgaLabel();
    gBays = el('g', {}, svg); gHoses = el('g', {}, svg); gCars = el('g', {}, svg); gLabels = el('g', {}, svg);
    geo.forEach(function (g, ci) {
      g.bays.forEach(function (bay, hi) {
        var rr = el('rect', { x: bay.x + 4, y: TOP + 6, width: BAY - 8, height: DEPTH, fill: 'transparent', class: 'bay' }, gBays);
        rr.addEventListener('click', function () { if (running && !bays[ci + ':' + (hi + 1)]) arrive(ci, hi + 1); });
        el('line', { x1: bay.x, x2: bay.x, y1: TOP, y2: TOP + DEPTH + 10, stroke: 'var(--paint)', 'stroke-width': 3 }, gBays);
        el('line', { x1: bay.x + BAY, x2: bay.x + BAY, y1: TOP, y2: TOP + DEPTH + 10, stroke: 'var(--paint)', 'stroke-width': 3 }, gBays);
        // EV bay marking, coloured by the connector status
        el('rect', { x: bay.x + 10, y: TOP + DEPTH - 30, width: BAY - 20, height: 26, rx: 5, fill: 'var(--off)', opacity: .9, id: 'mark-' + ci + '-' + hi }, gBays);
        el('text', { x: bay.cx, y: TOP + DEPTH - 12, 'text-anchor': 'middle', class: 'lbl s', id: 'mtxt-' + ci + '-' + hi }, gBays);
        el('text', { x: bay.cx, y: TOP + DEPTH + 30, 'text-anchor': 'middle', class: 'lbl', id: 'kw-' + ci + '-' + hi }, gLabels);
        el('path', { id: 'hose-' + ci + '-' + hi, class: 'hose', d: '', stroke: 'var(--off)' }, gHoses);
      });
      // The charger on its island, between its bays
      var p = el('g', { class: 'pedestal' }, gBays);
      el('rect', { x: g.ped.x + 6, y: TOP, width: PED - 12, height: 120, rx: 10, fill: 'var(--curb)' }, p);
      el('rect', { class: 'body', x: g.ped.cx - 18, y: TOP + 14, width: 36, height: 52, rx: 7, fill: '#1e293b', stroke: '#0b1220', 'stroke-width': 2 }, p);
      el('rect', { x: g.ped.cx - 12, y: TOP + 20, width: 24, height: 13, rx: 2, fill: '#0f172a', stroke: '#334155' }, p);
      el('circle', { id: 'led-' + ci, cx: g.ped.cx, cy: TOP + 50, r: 7, fill: 'var(--off)' }, p);
      el('line', { x1: g.ped.cx, x2: g.ped.cx, y1: 50, y2: TOP + 14, stroke: '#334155', 'stroke-width': 4 }, p);
      el('text', { x: g.ped.cx, y: TOP + 90, 'text-anchor': 'middle', class: 'lbl s' }, p).textContent = cfg.chargers[ci].name;
      el('text', { x: g.ped.cx, y: TOP + 106, 'text-anchor': 'middle', class: 'lbl s' }, p).textContent =
        fmt(cfg.chargers[ci].kw, cfg.chargers[ci].kw % 1 ? 1 : 0) + ' kW' + (cfg.chargers[ci].kw > 22 ? ' DC' : '');
      p.addEventListener('click', function () { openDialog(ci); });
    });
    cars.forEach(function (car) { gCars.appendChild(car.el); });
    paint();
    if (site.onLayout) site.onLayout();
  }

  // ── Cars ───────────────────────────────────────────────────────────────────────────────────────────
  var cars = [], bays = {};   // bays['ci:hose'] = car
  function carShape(color) {
    var g = el('g', { class: 'car' });
    el('rect', { x: -27, y: -52, width: 54, height: 104, rx: 16, fill: color, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 2 }, g);
    el('path', { d: 'M-21 -28 Q0 -40 21 -28 L19 -14 L-19 -14 Z', fill: '#0f172a', opacity: .8 }, g);   // windscreen (front, up)
    el('rect', { x: -19, y: -10, width: 38, height: 40, rx: 6, fill: 'rgba(0,0,0,.18)' }, g);            // roof
    el('path', { d: 'M-19 34 L19 34 L17 44 L-17 44 Z', fill: '#0f172a', opacity: .7 }, g);               // rear window
    el('rect', { x: -14, y: 2, width: 28, height: 9, rx: 3, fill: 'rgba(15,23,42,.8)' }, g);             // battery gauge
    el('rect', { x: -12, y: 4, width: 0, height: 5, rx: 2, fill: '#4ade80', class: 'soc' }, g);
    return g;
  }
  function place(car, x, y, r, slow) {
    car.el.setAttribute('class', 'car' + (slow ? ' turn' : ''));
    car.el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + r + 'deg)';
  }
  var nextCard = 1;
  function arrive(ci, hose) {
    var post = live[ci]; if (!post || !post.charger.state.connected || post.charger.state.powerOff) return;
    var key = ci + ':' + hose; if (bays[key]) return;
    var model = CARS[Math.floor(Math.random() * CARS.length)];
    var car = { ci: ci, hose: hose, key: key, model: model, phase: 'in', card: 'CAR-' + (1000 + nextCard++), el: carShape(model.color),
                dwellUntil: Date.now() + (cfg.arr > 60 ? 300000 + Math.random() * 600000 : 150000 + Math.random() * 300000) };
    bays[key] = car; cars.push(car); gCars.appendChild(car.el);
    car.el.addEventListener('click', function (e) { e.stopPropagation(); leave(car); });
    var bx = geo[ci].bays[hose - 1].cx;
    place(car, W + 90, LANE + 30, -90);
    car.el.getBoundingClientRect();                        // the start position must be painted before moving
    setTimeout(function () { place(car, bx, LANE + 30, -90); }, 30);
    setTimeout(function () { place(car, bx, TOP + DEPTH - 78, 0, true); }, 2500);
    setTimeout(function () {
      if (car.phase !== 'in') return;
      car.phase = 'parked';
      var m = JSON.parse(JSON.stringify(model)); m.soc = Math.round(10 + Math.random() * 45); m.targetSoc = Math.random() < 0.4 ? 80 : 100;
      post.charger.plugIn(hose, m);
      setTimeout(function () { if (car.phase === 'parked') post.charger.tapCard(car.card, hose); }, 1400);
    }, 4000);
  }
  function leave(car) {
    if (car.phase === 'out') return;
    var post = live[car.ci], c = post ? post.charger.state.connectors[car.hose - 1] : null;
    car.phase = 'out';
    var go = function () {
      if (post) post.charger.unplug(car.hose);
      var bx = geo[car.ci] ? geo[car.ci].bays[car.hose - 1].cx : W / 2;
      place(car, bx - 40, LANE - 20, -90, true);
      setTimeout(function () { place(car, -120, LANE - 20, -90); }, 1500);
      setTimeout(function () { if (bays[car.key] === car) delete bays[car.key]; }, 1500);
      setTimeout(function () { car.el.remove(); var i = cars.indexOf(car); if (i >= 0) cars.splice(i, 1); }, 4200);
    };
    // The driver ends the session with the same card, then unplugs and drives off
    if (c && c.transactionId != null && post.charger.state.connected) { post.charger.tapCard(car.card, car.hose); setTimeout(go, 1600); }
    else go();
  }

  // ── Running ─────────────────────────────────────────────────────────────────────────────────────────
  var running = false, live = [], history = [], overSince = null, tripUntil = 0;
  function log(id, dir, frame) {
    var f = $('logf').value, quiet = $('nometer').checked;
    if (f && f !== id) return;
    var action = frame[0] === 2 ? frame[2] : '';
    if (quiet && (action === 'MeterValues' || action === 'Heartbeat' || (frame[0] === 3 && frame[2] && (frame[2].currentTime || Object.keys(frame[2]).length === 0)))) return;
    var line = document.createElement('div'); line.className = dir;
    line.textContent = new Date().toLocaleTimeString() + '  ' + id + (dir === 'out' ? '  →  ' : '  ←  ') + JSON.stringify(frame);
    var box = $('log'); box.appendChild(line);
    while (box.childNodes.length > 500) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function connectCharger(ci) {
    var c = cfg.chargers[ci];
    return { name: c.name, charger: OcppVirtualCharger(cfg.url + encodeURIComponent(c.name), {
      connectors: c.hoses, powerKw: c.kw, chargerMaxKw: c.max, socSpeed: cfg.speed, waitForPlug: true,
      vendor: 'ocpp-virtual-charger', model: 'Virtual site post',
      onFrame: function (dir, fr) { log(c.name, dir, fr); }
    }) };
  }
  var startedAt = null, lastArrival = null;
  function start() {
    startedAt = Date.now(); lastArrival = null;
    $('msg').textContent = '';
    if (!/^wss?:\/\/.+\/$/.test(cfg.url || '')) { $('msg').textContent = TXT.noUrl; $('c-url').focus(); return; }
    running = true;
    $('b-start').hidden = true; $('b-stop').hidden = false; $('c-n').disabled = true; $('c-url').disabled = true;
    live = [];
    $('logf').innerHTML = '<option value="">' + (TXT.all || 'All chargers') + '</option>';
    for (var ci = 0; ci < cfg.n; ci++) {
      live.push(connectCharger(ci));
      var o = document.createElement('option'); o.textContent = cfg.chargers[ci].name; $('logf').appendChild(o);
    }
  }
  function stopAll() {
    cars.slice().forEach(function (car) { car.el.remove(); }); cars = []; bays = {};
    live.forEach(function (p) { p.charger.close(); }); live = [];
    running = false; history = []; overSince = null; tripUntil = 0;
    $('b-start').hidden = false; $('b-stop').hidden = true; $('c-n').disabled = false; $('c-url').disabled = false;
    paint();
  }
  $('b-start').onclick = start; $('b-stop').onclick = stopAll;

  // ── The dialog of a charger ─────────────────────────────────────────────────────────────────────────
  var editing = null;
  function openDialog(ci) {
    editing = ci; var c = cfg.chargers[ci];
    $('dlg-title').textContent = t('charger', { n: ci + 1 });
    $('d-name').value = c.name; $('d-kw').value = String(c.kw); $('d-hoses').value = String(c.hoses); $('d-max').value = c.max;
    var PH = ES ? ['R', 'S', 'T'] : ['P1', 'P2', 'P3']; Array.prototype.forEach.call($('d-phase').options, function (o, i) { o.textContent = PH[i]; });
    $('d-phase').value = String(c.phase || (ci % 3) + 1); $('d-phase').disabled = cfg.phases === 1;
    $('d-name').setCustomValidity('');
    showAddr(); $('dlg').showModal(); $('d-name').focus();
  }
  function showAddr() { $('d-addr').textContent = (cfg.url || 'wss://…/') + ($('d-name').value || '…'); }
  $('d-name').addEventListener('input', function () { $('d-name').setCustomValidity(''); showAddr(); });
  function suggestMax() {   // a sensible "whole charger" value when the power or the hoses change
    var kw = parseFloat($('d-kw').value), h = parseInt($('d-hoses').value, 10);
    $('d-max').value = kw > 22 ? kw : Math.max(kw, Math.min(kw * h, 22));
  }
  $('d-kw').onchange = suggestMax; $('d-hoses').onchange = suggestMax;
  $('dlg-form').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    var name = $('d-name').value.trim();
    if (cfg.chargers.some(function (c, i) { return i !== editing && i < cfg.n && c.name === name; })) {
      e.preventDefault(); $('d-name').setCustomValidity(TXT.dupName); $('d-name').reportValidity(); return;
    }
    var c = cfg.chargers[editing], before = JSON.stringify(c);
    c.name = name; c.kw = parseFloat($('d-kw').value); c.hoses = parseInt($('d-hoses').value, 10); c.max = parseFloat($('d-max').value) || c.kw * c.hoses;
    c.phase = parseInt($('d-phase').value, 10) || 1;
    save();
    if (JSON.stringify(c) === before) return;
    var ci = editing;
    if (running && live[ci]) {
      // Only this charger: its cars leave, it reconnects with the new name and power
      cars.filter(function (car) { return car.ci === ci; }).forEach(function (car) { car.el.remove(); delete bays[car.key]; cars.splice(cars.indexOf(car), 1); });
      live[ci].charger.close(); live[ci] = connectCharger(ci);
      $('logf').options[ci + 1].textContent = c.name;
    }
    layout();
  });

  // ── The building: a usual load that wanders, plus peaks now and then (lift, heating, kitchen) ───────
  var walk = 1, peakKw = 0, peakUntil = 0, building = 0;
  setInterval(function () { walk = Math.max(0.6, Math.min(1.4, walk + (Math.random() - 0.5) * 0.12)); }, 5000);
  function buildingLoad(now) {
    if (cfg.peaks && now > peakUntil && Math.random() < (cfg.peaks === 2 ? 1 / 25 : 1 / 70)) {
      peakKw = Math.max(1.5, cfg.base) * (0.4 + Math.random() * 0.9); peakUntil = now + 8000 + Math.random() * 30000;
    }
    if (now > peakUntil) peakKw = 0;
    return cfg.base * walk + peakKw;
  }

  // ── Every second: totals, breaker, arrivals and departures, the drawing ────────────────────────────
  setInterval(function () {
    var now = Date.now(), cut = now < tripUntil;
    building = cut ? 0 : buildingLoad(now);
    if (cfg.sb && running) localBalancer();
    var chg = live.reduce(function (s, p) { return s + (p.charger.state.totalKw || 0); }, 0);
    var total = building + chg;
    if (running && !cut && cfg.trip > 0 && total > cfg.grid) {
      overSince = overSince || now;
      if (now - overSince >= cfg.trip * 1000) { tripUntil = now + 30000; overSince = null; live.forEach(function (p) { p.charger.powerLoss(30); }); }
    } else overSince = null;
    if (running) {
      history.push({ total: total, chg: chg }); if (history.length > 600) history.shift();
      traffic(now);
    }
    side(total, chg, cut, now);
    paint(total, chg, cut);
    if (site.onTick) site.onTick(now, cut);
  }, 1000);

  // The local balancer (SB): measures the LGA and caps every charger itself, outside OCPP. Like a good one, it gives each
  // charging hose at least its minimum (6 A per phase) in order of arrival while what the building leaves free (minus
  // the margin) allows it, and shares the rest equally; the hoses that don't fit wait. Never everyone below the minimum.
  // With a plan, it also keeps every cable under its breaker (OvcPlano.calc.allocate, tested in test/plano.test.js).
  function localBalancer() {
    var keep = 1 - cfg.sbMargin / 100, free = Math.max(0, cfg.grid * keep - building), hoses = [], caps = {};
    var lineCaps = site.lineCaps ? site.lineCaps() : {};
    Object.keys(lineCaps).forEach(function (k) { caps[k] = lineCaps[k] * keep; });
    live.forEach(function (p, ci) {
      var kw = cfg.chargers[ci].kw, sup = kw > 22 ? 0 : (kw > 7.4 ? 3 : 1), line = site.lineFor ? site.lineFor(ci) : null;
      p.charger.state.connectors.forEach(function (c) {
        if (c.transactionId == null) return;
        var ph = sup && c.car && c.car.phases ? Math.min(sup, c.car.phases) : sup;
        var want = Math.min(kw, c.car ? (sup ? c.car.maxAcKw || kw : c.car.maxDcKw || kw) : kw);
        if (c.status === 'SuspendedEV') want = 0;
        hoses.push({ ci: ci, since: c.txStartedAt || 0, min: ph ? 6 * 230 * ph / 1000 : 1, want: want, got: 0, line: line,
                     apk: window.OvcPlano.calc.ampsPerKw(kw, c.car && c.car.phases, cfg.phases) });
      });
    });
    window.OvcPlano.calc.allocate(hoses, free, caps);
    free = Math.max(0, cfg.grid * keep - building) - hoses.reduce(function (s, h) { return s + h.got; }, 0);
    live.forEach(function (p, ci) {
      var mine = hoses.filter(function (h) { return h.ci === ci; });
      var cap = mine.length ? mine.reduce(function (s, h) { return s + h.got; }, 0) : Math.min(cfg.chargers[ci].max, free);
      cap = Math.round(Math.min(cfg.chargers[ci].max, cap) * 10) / 10;
      if (p.sbKw !== cap) { p.sbKw = cap; p.charger.setChargerMax(cap || 0.01); }
    });
  }

  function traffic(now) {
    // The first car comes a few seconds after switching on (an empty car park for a minute looks broken); then at random
    var first = !cars.length && startedAt && now - startedAt > 4000 && (!lastArrival || now - lastArrival > 4000);
    if (cfg.arr > 0 && (first || Math.random() < 1 / cfg.arr)) {
      var free = [];
      live.forEach(function (p, ci) {
        if (p.charger.state.connected && !p.charger.state.powerOff) p.charger.state.connectors.forEach(function (c) {
          if (!bays[ci + ':' + c.id] && c.available && (!site.canPark || site.canPark(ci, c.id))) free.push([ci, c.id]);
        });
      });
      if (free.length) lastArrival = now;
      if (free.length) { var f = free[Math.floor(Math.random() * free.length)]; arrive(f[0], f[1]); }
    }
    // Un coche aparcado y enchufado sin carga (tras un corte de luz, o si la tarjeta no pasó) vuelve a pasar su
    // tarjeta, como haría el conductor o el propio cargador al volver la luz
    cars.forEach(function (car) {
      if (car.phase !== 'parked') return;
      var post = live[car.ci], s = post && post.charger.state, c = s && s.connectors[car.hose - 1];
      if (!c || !s.connected || s.powerOff || !c.plugged || c.transactionId != null || c.status !== 'Preparing') { car.idleSince = null; return; }
      car.idleSince = car.idleSince || now;
      if (now - car.idleSince > 4000 && (!car.retap || now - car.retap > 30000)) { car.retap = now; post.charger.tapCard(car.card, car.hose); }
    });
    if (cfg.arr > 0) cars.forEach(function (car) {
      if (car.phase !== 'parked') return;
      var c = live[car.ci] && live[car.ci].charger.state.connectors[car.hose - 1];
      if (c && c.status === 'SuspendedEV') { car.fullSince = car.fullSince || now; if (now - car.fullSince > 8000) leave(car); }
      else if (now > car.dwellUntil) leave(car);
    });
  }

  var COLORS = { Available: 'var(--av)', Charging: 'var(--chg)', Preparing: 'var(--wait)', Finishing: 'var(--wait)',
                 SuspendedEV: 'var(--wait)', SuspendedEVSE: 'var(--wait)', Faulted: 'var(--bad)', Unavailable: 'var(--off)', Reserved: 'var(--in)' };
  var flowW = function (kw) { return kw > 0.05 ? Math.min(12, 2 + kw / 4) : 0; };
  function paint(total, chg, cut) {
    // Building: its load, lit windows, the LGA and the feeder to the chargers
    var bk = $('bld-kw'); if (bk) bk.textContent = fmt(building, 1) + ' kW' + (peakKw ? ' · ' + TXT.peak : '');
    var lit = Math.round(windows.length * Math.min(1, building / Math.max(1, cfg.base * 1.8)));
    windows.forEach(function (w, i) { w.setAttribute('fill', i < lit && !cut ? '#fde68a' : '#475569'); });
    var lga = $('lga'); if (lga) lga.setAttribute('stroke-width', flowW(total || 0));
    var feed = $('feed'); if (feed) feed.setAttribute('stroke-width', flowW(chg || 0));
    var br = $('breaker'); if (br) br.setAttribute('fill', cut ? 'var(--bad)' : 'var(--av)');
    var sb = $('sb-box'); if (sb) sb.style.display = cfg.sb ? '' : 'none';
    geo.forEach(function (g, ci) {
      var p = live[ci], s = p ? p.charger.state : null;
      var led = $('led-' + ci);
      if (led) {
        led.setAttribute('fill', !s ? 'var(--off)' : s.powerOff || s.gaveUp ? 'var(--bad)' : !s.connected ? 'var(--off)' : s.totalKw > 0 ? 'var(--chg)' : 'var(--av)');
        led.setAttribute('class', s && s.totalKw > 0 ? 'led-chg' : '');
      }
      g.bays.forEach(function (b, hi) {
        var c = s ? s.connectors[hi] : null, st = !s || !s.connected || s.powerOff ? null : c && c.status;
        var mark = $('mark-' + ci + '-' + hi), mt = $('mtxt-' + ci + '-' + hi), kw = $('kw-' + ci + '-' + hi), hose = $('hose-' + ci + '-' + hi);
        if (!mark) return;
        mark.setAttribute('fill', st ? COLORS[st] || 'var(--off)' : 'var(--off)');
        mt.textContent = st || (s ? (s.powerOff ? TXT.powerOff : s.gaveUp ? TXT.gaveUp : TXT.connecting) : TXT.off);
        var car = bays[ci + ':' + (hi + 1)];
        kw.textContent = c && c.powerKw > 0 ? fmt(c.powerKw, 1) + ' kW · ' + Math.floor(c.car ? c.car.soc : 0) + ' %'
          : c && c.status === 'SuspendedEV' ? TXT.full + ' · ' + Math.floor(c.car ? c.car.soc : 100) + ' %'
          : c && c.status === 'SuspendedEVSE' ? TXT.paused : c && c.awaitingPlug ? TXT.waiting : '';
        // Hose from the charger to the car's charging port (front corner on the charger side)
        if (c && c.plugged && car && car.phase === 'parked') {
          var sd = b.cx < g.ped.cx ? 1 : -1, px = g.ped.cx - sd * 16, py = TOP + 58;
          var cx = b.cx + sd * 20, cy = TOP + DEPTH - 78 - 46;
          hose.setAttribute('d', 'M' + px + ' ' + py + ' C' + (px - sd * 10) + ' ' + (py + 50) + ',' + (cx + sd * 30) + ' ' + (cy - 10) + ',' + cx + ' ' + cy);
          hose.setAttribute('stroke', COLORS[c.status] || 'var(--off)');
          hose.setAttribute('class', 'hose' + (c.powerKw > 0 ? ' flow' : ''));
        } else hose.setAttribute('d', '');
        if (car) {
          var bar = car.el.querySelector('.soc'), soc = c && c.car ? c.car.soc : null;
          if (bar && soc != null) bar.setAttribute('width', String(24 * soc / 100));
        }
      });
    });
  }

  function side(total, chg, cut, now) {
    $('t-total').textContent = fmt(total, 1) + ' kW';
    $('t-of').textContent = t('of', { k: fmt(cfg.grid, 1) }) + ' · ' + t('building', { k: fmt(building, 1) });
    var scale = Math.max(cfg.grid * 1.25, total, 1);
    var g = $('gauge'); g.setAttribute('width', String(Math.min(300, 300 * total / scale)));
    g.setAttribute('class', 'gauge' + (total > cfg.grid ? ' over' : total > cfg.grid * 0.9 ? ' warn' : ''));
    var lx = 300 * cfg.grid / scale; $('g-lim').setAttribute('x1', lx); $('g-lim').setAttribute('x2', lx);
    var st = $('t-state');
    if (cut) { st.className = 'trip'; st.textContent = t('tripped', { s: Math.ceil((tripUntil - now) / 1000) }); }
    else if (overSince) { st.className = 'trip'; st.textContent = t('tripIn', { s: Math.max(0, Math.ceil((overSince + cfg.trip * 1000 - now) / 1000)) }); }
    else { st.className = 'small'; st.textContent = total > cfg.grid ? TXT.over || 'Above the LGA' : TXT.ok || 'Within the LGA'; }
    // Chart: what the site draws against the LGA
    var Wc = 300, Hc = 120, n = 600, y = function (kw) { return Hc - 3 - (Hc - 6) * Math.min(1, kw / scale); };
    var line = function (k) { return history.map(function (h, i) { return (Wc * (i + n - history.length) / (n - 1)).toFixed(1) + ',' + y(h[k]).toFixed(1); }).join(' '); };
    $('chart').innerHTML = '<rect width="300" height="120" fill="var(--soft)"/><line x1="0" x2="300" y1="' + y(cfg.grid) + '" y2="' + y(cfg.grid) + '" stroke="var(--bad)" stroke-dasharray="5 4"/>' +
      (history.length > 1 ? '<polyline fill="none" stroke="var(--off)" stroke-width="1.5" points="' + line('total') + '"/><polyline fill="none" stroke="var(--chg)" stroke-width="2" points="' + line('chg') + '"/>' : '');
    // One line per charger
    $('list').innerHTML = cfg.chargers.slice(0, cfg.n).map(function (c, ci) {
      var s = live[ci] ? live[ci].charger.state : null;
      var net = !s ? TXT.off : s.powerOff ? TXT.powerOff : s.gaveUp ? TXT.gaveUp : s.offline ? TXT.offline : s.connected ? TXT.online : TXT.connecting;
      var col = !s || !s.connected ? 'var(--off)' : s.totalKw > 0 ? 'var(--chg)' : 'var(--av)';
      var lim = (s && s.chargePointLimitKw != null ? ' · ≤' + fmt(s.chargePointLimitKw, 1) : '') +
                (cfg.sb && live[ci] && live[ci].sbKw != null ? ' · ' + t('sbCap', { k: fmt(live[ci].sbKw, 1) }) : '');
      return '<div><span><span class="dot" style="background:' + col + '"></span>' + c.name.replace(/[<>&"]/g, '') + '</span><span>' +
             (s ? fmt(s.totalKw, 1) + ' kW' + lim + ' · ' : '') + net + '</span></div>';
    }).join('');
  }

  $('logf').onchange = function () { $('log').textContent = ''; };
  // What the plan view (plano.js) needs from the site
  var site = { cfg: cfg, ES: ES, save: save, live: function () { return live; }, running: function () { return running; },
               bays: function () { return bays; }, arrive: arrive, leave: leave, openDialog: openDialog, openLga: openLga, canPark: null, onTick: null, onLayout: null, lineFor: null, lineCaps: null };
  if (window.OvcPlano) window.OvcPlano.mount(site);
  lgaButton();
  layout();
})();
