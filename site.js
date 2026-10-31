// The site page (site.html): several virtual chargers behind one grid connection, driven by ocpp-virtual-charger.js.
// Everything that shapes the test is a setting on the page (grid connection, building load, posts, connectors,
// power, cars), kept in localStorage so a scenario survives a reload.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ES = /^es\b/i.test(navigator.language || '') || /[?&]lang=es\b/.test(location.search);
  var HOSTED = location.hostname === 'askacharge.com';

  var TXT = ES ? {
    title: 'Simulador de instalación de carga OCPP',
    lead: 'Varios cargadores detrás de una sola acometida, coches que se llenan y perfiles de carga OCPP que limitan la potencia de verdad. Para probar el reparto de carga de una plataforma.',
    setup: 'Instalación', gridKw: 'Potencia de la acometida (kW)', baseKw: 'Consumo del edificio (kW)', baseVar: 'El consumo del edificio varía',
    tripLbl: 'Salta el general si se supera durante', never: 'Nunca', speed: 'Las baterías se llenan', real: 'a velocidad real',
    arrivals: 'Llegan coches solos', arr60: '≈ cada minuto', arr300: '≈ cada 5 minutos', no: 'No', yes: 'Sí',
    posts: 'Puestos de carga', thConn: 'Mangueras', thKw: 'kW cada una', thMax: 'Máx. del puesto (kW)', addPost: '+ Añadir puesto',
    target: 'Dónde se conectan los cargadores', modeTest: 'Servidor de pruebas OCPP de askacharge.com (gratis, sin cuenta)', modeOwn: 'Mi CSMS',
    baseUrl: 'Dirección OCPP sin la identidad (acaba en /)', prefix: 'Prefijo de la identidad',
    ownHelp: 'Cada cargador es esta dirección + su identidad. Desde el navegador no se puede mandar contraseña (Basic Auth): usa un CSMS o un entorno de pruebas que los acepte sin ella, o lanza la instalación desde Node.',
    start: 'Encender la instalación', stopAll: 'Apagarlo todo', watch: 'Verlo en el servidor de pruebas →',
    install: 'Acometida', grid: 'Red', board: 'Cuadro', board2: 'general', building: 'Edificio', chargers: 'Cargadores',
    draw: 'Consumo de la red', lgTotal: 'consumo de la red', lgChg: 'cargadores', lgLim: 'acometida', lgWin: 'últimos 10 minutos',
    frames: 'Mensajes OCPP', all: 'Todos los cargadores', hideMeter: 'ocultar MeterValues y Heartbeat',
    promoT: '¿Tienes una instalación de verdad?', promoB: 'Prueba 30 días gratis',
    promoP: 'askacharge.com reparte la potencia de una instalación entre sus cargadores con OCPP estándar, con tus tarifas y tus cobros, y sin atarte a ningún fabricante. Pruébalo 30 días gratis, sin tarjeta.',
    simple: 'Un simulador, dicho claro: el OCPP es de verdad; la física está simplificada (curvas de carga de los coches, consumo del edificio).',
    single: 'Un solo cargador', madeby: 'Hecho por',
    of: 'de {k} kW', over: 'Por encima de la acometida', ok: 'Dentro de la acometida', tripped: '⚡ Ha saltado el general: sin luz {s} s',
    tripIn: 'Salta el general en {s} s', online: 'conectado', offline: 'sin red', powerOff: 'sin luz', connecting: 'conectando…', gaveUp: 'rechazado',
    conn: 'Manguera {n}', plug: 'Enchufar', unplug: 'Desenchufar', card: 'Pasar tarjeta', stopCard: 'Parar (tarjeta)',
    netCut: 'Corte de red 20 s', powerCut: 'Corte de luz 30 s', limit: 'Límite {k} kW · {by}', postMax: 'Puesto limitado a {k} kW · {by}',
    full: 'lleno', waitCard: 'esperando la tarjeta', session: '{k} kWh', remove: 'Quitar',
    needTest: 'El servidor de pruebas admite hasta 5 cargadores por código: con más puestos, usa tu CSMS.',
    noUrl: 'Escribe la dirección OCPP de tu CSMS, acabada en /.', noCode: 'No se ha podido pedir un código al servidor de pruebas. Usa tu CSMS.',
    cars: { small: 'Utilitario 40 kWh · 7,4 kW', saloon: 'Berlina 64 kWh · 11 kW', suv: 'SUV 77 kWh · 11 kW', van: 'Furgoneta 75 kWh · 22 kW', phev: 'Híbrido 13 kWh · 3,7 kW' }
  } : {
    of: 'of {k} kW', over: 'Above the grid connection', ok: 'Within the grid connection', tripped: '⚡ The main breaker tripped: no power for {s} s',
    tripIn: 'Main breaker trips in {s} s', online: 'online', offline: 'offline', powerOff: 'no power', connecting: 'connecting…', gaveUp: 'rejected',
    conn: 'Connector {n}', plug: 'Plug in', unplug: 'Unplug', card: 'Tap card', stopCard: 'Stop (card)',
    netCut: 'Network outage 20 s', powerCut: 'Power cut 30 s', limit: 'Limit {k} kW · {by}', postMax: 'Post limited to {k} kW · {by}',
    full: 'full', waitCard: 'waiting for a card', session: '{k} kWh', remove: 'Remove',
    needTest: 'The test server takes up to 5 chargers per code: with more posts, use your own CSMS.',
    noUrl: 'Type your CSMS OCPP address, ending in /.', noCode: 'Could not get a code from the test server. Use your own CSMS.',
    cars: { small: 'Small car 40 kWh · 7.4 kW', saloon: 'Saloon 64 kWh · 11 kW', suv: 'SUV 77 kWh · 11 kW', van: 'Van 75 kWh · 22 kW', phev: 'Plug-in hybrid 13 kWh · 3.7 kW' }
  };
  function t(k, v) { var s = TXT[k] || k; Object.keys(v || {}).forEach(function (x) { s = s.replace('{' + x + '}', v[x]); }); return s; }
  if (ES) {
    document.documentElement.lang = 'es';
    document.title = 'Simulador de instalación de carga OCPP — varios cargadores, una acometida';
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { if (TXT[el.dataset.t]) el.textContent = TXT[el.dataset.t]; });
  }
  function fmt(n, d) { return Number(n || 0).toLocaleString(ES ? 'es-ES' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Cars: battery, what they accept in AC and DC, phases. A simulator's cars, not a catalogue.
  var CARS = {
    small: { batteryKwh: 40, maxAcKw: 7.4, maxDcKw: 50, phases: 1 },
    saloon: { batteryKwh: 64, maxAcKw: 11, maxDcKw: 100, phases: 3 },
    suv: { batteryKwh: 77, maxAcKw: 11, maxDcKw: 150, phases: 3 },
    van: { batteryKwh: 75, maxAcKw: 22, maxDcKw: 80, phases: 3 },
    phev: { batteryKwh: 13, maxAcKw: 3.7, maxDcKw: 0, phases: 1 }
  };
  var POWERS = [3.7, 7.4, 11, 22, 50, 150];

  // ── Settings ────────────────────────────────────────────────────────────────────────────────────────
  var DEFAULT = { grid: 30, base: 6, baseVar: 1, trip: 0, speed: 60, arr: 0, mode: HOSTED ? 'test' : 'own', url: '', prefix: 'SITE',
                  posts: [{ conn: 2, kw: 11, max: 22 }, { conn: 2, kw: 11, max: 22 }, { conn: 2, kw: 22, max: 22 }, { conn: 2, kw: 22, max: 44 }] };
  var cfg;
  try { cfg = JSON.parse(localStorage.getItem('ovc-site') || 'null'); } catch (e) {}
  if (!cfg || !cfg.posts) cfg = JSON.parse(JSON.stringify(DEFAULT));
  function save() { try { localStorage.setItem('ovc-site', JSON.stringify(cfg)); } catch (e) {} }

  function bind(id, key, num) {
    var el = $(id); el.value = cfg[key];
    el.onchange = function () { cfg[key] = num ? parseFloat(el.value) || 0 : el.value; save(); applyLive(); };
  }
  bind('c-grid', 'grid', true); bind('c-base', 'base', true); bind('c-basevar', 'baseVar', true); bind('c-trip', 'trip', true);
  bind('c-speed', 'speed', true); bind('c-arr', 'arr', true); bind('c-url', 'url'); bind('c-prefix', 'prefix');
  var mode = $('c-mode'); mode.value = HOSTED ? cfg.mode : 'own'; mode.disabled = !HOSTED;
  function showMode() { $('own').hidden = mode.value !== 'own'; }
  mode.onchange = function () { cfg.mode = mode.value; save(); showMode(); }; showMode();

  function renderPostsEditor() {
    var tb = $('c-posts'); tb.innerHTML = '';
    cfg.posts.forEach(function (p, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (i + 1) + '</td>' +
        '<td><select data-k="conn">' + [1, 2, 3, 4].map(function (n) { return '<option' + (n === p.conn ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></td>' +
        '<td><select data-k="kw">' + POWERS.map(function (k) { return '<option value="' + k + '"' + (k === p.kw ? ' selected' : '') + '>' + fmt(k, k % 1 ? 1 : 0) + (k > 22 ? ' DC' : '') + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-k="max" type="number" min="1" step="0.1" value="' + p.max + '"></td>' +
        '<td><button data-del>×</button></td>';
      Array.prototype.forEach.call(tr.querySelectorAll('[data-k]'), function (el) {
        el.onchange = function () { p[el.dataset.k] = parseFloat(el.value); save(); };
      });
      tr.querySelector('[data-del]').onclick = function () { if (cfg.posts.length > 1) { cfg.posts.splice(i, 1); save(); renderPostsEditor(); } };
      tr.querySelector('[data-del]').disabled = running;
      Array.prototype.forEach.call(tr.querySelectorAll('select, input'), function (el) { el.disabled = running; });
      tb.appendChild(tr);
    });
    $('b-addpost').disabled = running || cfg.posts.length >= 10;
  }
  $('b-addpost').onclick = function () { var l = cfg.posts[cfg.posts.length - 1]; cfg.posts.push({ conn: l.conn, kw: l.kw, max: l.max }); save(); renderPostsEditor(); };

  // ── Running site ────────────────────────────────────────────────────────────────────────────────────
  var running = false, posts = [], building = 0, history = [], overSince = null, tripUntil = 0, dirty = true;
  renderPostsEditor();

  function applyLive() {
    posts.forEach(function (p) { p.charger.setSocSpeed(cfg.speed); });
    dirty = true;
  }

  function log(id, dir, frame) {
    var f = $('logf').value, quiet = $('nometer').checked;
    if (f && f !== id) return;
    var action = frame[0] === 2 ? frame[2] : '';
    if (quiet && (action === 'MeterValues' || action === 'Heartbeat' || (frame[0] === 3 && frame[2] && (frame[2].currentTime || Object.keys(frame[2]).length === 0)))) return;
    var line = document.createElement('div');
    line.className = dir;
    line.textContent = new Date().toLocaleTimeString() + '  ' + id + (dir === 'out' ? '  →  ' : '  ←  ') + JSON.stringify(frame);
    var box = $('log'); box.appendChild(line);
    while (box.childNodes.length > 500) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function start() {
    $('msg').textContent = '';
    var prefix = (cfg.prefix || 'SITE').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 14) || 'SITE';
    var go = function (base) {
      running = true; renderPostsEditor();
      $('b-start').hidden = true; $('b-stop').hidden = false; mode.disabled = true;
      $('logf').innerHTML = '<option value="">' + esc(TXT.all || 'All chargers') + '</option>';
      posts = cfg.posts.map(function (p, i) {
        var id = prefix + '-' + (i + 1);
        $('logf').insertAdjacentHTML('beforeend', '<option>' + esc(id) + '</option>');
        return { id: id, cfg: p, charger: OcppVirtualCharger(base + encodeURIComponent(id), {
          connectors: p.conn, powerKw: p.kw, chargerMaxKw: p.max, socSpeed: cfg.speed, waitForPlug: true,
          vendor: 'ocpp-virtual-charger', model: 'Virtual site post', idTag: id + '-CARD',
          onChange: function () { dirty = true; }, onFrame: function (dir, fr) { log(id, dir, fr); }
        }) };
      });
      dirty = true;
    };
    if (mode.value === 'test') {
      if (cfg.posts.length > 5) { $('msg').textContent = TXT.needTest; return; }
      fetch('/askacharge/ocpp-test/api/nuevo', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.codigo) throw new Error('no code');
        var w = $('watch'); w.hidden = false;
        w.href = '/askacharge/' + (ES ? 'probar-ocpp.html' : 'en/ocpp-test-server.html') + '?c=' + d.codigo + '&src=virtual-site';
        go('wss://askacharge.com/askacharge/ocpp-test/' + d.codigo + '/');
      }).catch(function () { $('msg').textContent = TXT.noCode; });
    } else {
      var u = (cfg.url || '').trim();
      if (!/^wss?:\/\/.+\/$/.test(u)) { $('msg').textContent = TXT.noUrl; $('c-url').focus(); return; }
      go(u);
    }
  }
  function stopAll() {
    posts.forEach(function (p) { p.charger.close(); });
    posts = []; running = false; history = []; overSince = null; tripUntil = 0;
    $('b-start').hidden = false; $('b-stop').hidden = true; mode.disabled = !HOSTED; $('watch').hidden = true;
    $('posts').innerHTML = ''; renderPostsEditor(); dirty = true;
  }
  $('b-start').onclick = start;
  $('b-stop').onclick = stopAll;

  // Building load: a slow random walk around the setting (between 60 % and 140 %)
  var walk = 1;
  setInterval(function () {
    if (cfg.baseVar) walk = Math.max(0.6, Math.min(1.4, walk + (Math.random() - 0.5) * 0.12)); else walk = 1;
  }, 5000);

  // ── Each second: totals, the main breaker, arrivals and departures, the chart ──────────────────────
  setInterval(function () {
    var nowMs = Date.now(), cut = nowMs < tripUntil;
    building = running && !cut ? cfg.base * walk : 0;
    var chg = posts.reduce(function (s, p) { return s + (p.charger.state.totalKw || 0); }, 0);
    var total = building + chg;
    // Main breaker: above the grid connection for longer than the setting → everything loses power for 30 s
    if (running && !cut && cfg.trip > 0 && total > cfg.grid) {
      overSince = overSince || nowMs;
      if (nowMs - overSince >= cfg.trip * 1000) {
        tripUntil = nowMs + 30000; overSince = null;
        posts.forEach(function (p) { p.charger.powerLoss(30); });
      }
    } else overSince = null;
    if (running) {
      history.push({ total: total, chg: chg });
      if (history.length > 600) history.shift();
      arrivalsAndDepartures(nowMs);
    }
    paintInstallation(total, chg, cut, nowMs);
    if (dirty) { dirty = false; paintPosts(); }
    else if (posts.some(function (p) { return p.charger.state.totalKw > 0; })) paintPosts();
  }, 1000);

  // Cars arrive on their own: a random free connector, a random car, the card a few seconds later.
  // They leave a little after their battery is full.
  var nextArrival = 0;
  function arrivalsAndDepartures(nowMs) {
    if (cfg.arr > 0) {
      if (!nextArrival) nextArrival = nowMs + cfg.arr * 1000 * (0.3 + Math.random());
      if (nowMs >= nextArrival) {
        nextArrival = nowMs + cfg.arr * 1000 * (0.3 + Math.random() * 1.4);
        var free = [];
        posts.forEach(function (p) { if (p.charger.state.connected) p.charger.state.connectors.forEach(function (c) { if (!c.plugged && c.available) free.push([p, c.id]); }); });
        if (free.length) {
          var pick = free[Math.floor(Math.random() * free.length)], keys = Object.keys(CARS);
          plugCar(pick[0], pick[1], keys[Math.floor(Math.random() * keys.length)]);
          setTimeout(function () { pick[0].charger.tapCard(pick[0].id + '-C' + pick[1], pick[1]); }, 2500 + Math.random() * 4000);
        }
      }
    } else nextArrival = 0;
    posts.forEach(function (p) {
      p.charger.state.connectors.forEach(function (c) {
        if (cfg.arr > 0 && c.plugged && c.status === 'SuspendedEV') {
          c._fullSince = c._fullSince || nowMs;
          if (nowMs - c._fullSince > 20000) { c._fullSince = null; p.charger.unplug(c.id); }
        } else c._fullSince = null;
      });
    });
  }
  function plugCar(p, cid, kind) {
    var car = JSON.parse(JSON.stringify(CARS[kind] || CARS.saloon));
    car.kind = kind; car.soc = Math.round(10 + Math.random() * 50); car.targetSoc = Math.random() < 0.5 ? 80 : 100;
    p.charger.plugIn(cid, car);
  }

  function paintInstallation(total, chg, cut, nowMs) {
    $('t-grid').textContent = fmt(total, 1) + ' kW';
    $('t-bld').textContent = fmt(building, 1) + ' kW';
    $('t-chg').textContent = fmt(chg, 1) + ' kW';
    $('t-total').textContent = fmt(total, 1) + ' kW';
    $('t-of').textContent = t('of', { k: fmt(cfg.grid, 1) });
    var w = function (kw) { return kw > 0.05 ? Math.min(14, 2 + kw / 3) : 0; };
    $('w-grid').setAttribute('stroke-width', w(total)); $('w-bld').setAttribute('stroke-width', w(building)); $('w-chg').setAttribute('stroke-width', w(chg));
    var scale = Math.max(cfg.grid * 1.25, total, 1);
    var g = $('gauge'); g.setAttribute('width', String(Math.min(400, 400 * total / scale)));
    g.setAttribute('class', 'gauge' + (total > cfg.grid ? ' over' : (total > cfg.grid * 0.9 ? ' warn' : '')));
    var lx = 400 * cfg.grid / scale; $('g-lim').setAttribute('x1', lx); $('g-lim').setAttribute('x2', lx);
    $('breaker').setAttribute('fill', cut ? 'var(--bad)' : 'var(--av)');
    var st = $('t-state');
    if (cut) { st.className = 'trip'; st.textContent = t('tripped', { s: Math.ceil((tripUntil - nowMs) / 1000) }); }
    else if (overSince) { st.className = 'trip'; st.textContent = t('tripIn', { s: Math.max(0, Math.ceil((overSince + cfg.trip * 1000 - nowMs) / 1000)) }); }
    else { st.className = 'small'; st.textContent = running ? (total > cfg.grid ? TXT.over || 'Above the grid connection' : TXT.ok || 'Within the grid connection') : ''; }
    paintChart(scale);
  }
  function paintChart(scale) {
    var svg = $('chart'), W = 600, H = 150, n = 600;
    var y = function (kw) { return H - 4 - (H - 8) * Math.min(1, kw / scale); };
    var line = function (key) {
      return history.map(function (h, i) { return (W * (i + n - history.length) / (n - 1)).toFixed(1) + ',' + y(h[key]).toFixed(1); }).join(' ');
    };
    svg.innerHTML = '<rect width="600" height="150" fill="var(--soft)"/>' +
      '<line x1="0" x2="600" y1="' + y(cfg.grid) + '" y2="' + y(cfg.grid) + '" stroke="var(--bad)" stroke-dasharray="6 5" stroke-width="1.5"/>' +
      (history.length > 1 ? '<polyline fill="none" stroke="var(--wait)" stroke-width="2" points="' + line('chg') + '"/>' +
                            '<polyline fill="none" stroke="var(--chg)" stroke-width="2.5" points="' + line('total') + '"/>' : '');
  }

  function carName(car) { return car && car.kind && TXT.cars[car.kind] ? TXT.cars[car.kind] : ''; }
  function paintPosts() {
    var box = $('posts');
    if (!running) { box.innerHTML = ''; return; }
    var a = document.activeElement;
    if (a && a.tagName === 'SELECT' && box.contains(a)) { dirty = true; return; }   // don't close a list the user has open
    box.innerHTML = posts.map(function (p, pi) {
      var s = p.charger.state;
      var net = s.powerOff ? ['cut', TXT.powerOff] : (s.offline ? ['cut', TXT.offline] : (s.gaveUp ? ['cut', TXT.gaveUp] : (s.connected ? ['on', TXT.online] : ['', TXT.connecting])));
      var head = '<h3><span>' + esc(p.id) + '</span><span class="net ' + net[0] + '">' + esc(net[1]) + '</span></h3>' +
                 '<div class="small">' + s.connectors.length + ' × ' + fmt(p.cfg.kw, p.cfg.kw % 1 ? 1 : 0) + ' kW' + (p.cfg.kw > 22 ? ' DC' : ' AC') +
                 ' · <strong>' + fmt(s.totalKw, 1) + '</strong> / ' + fmt(s.chargerMaxKw, 0) + ' kW</div>';
      if (s.chargePointLimitKw != null) head += '<div class="lim">' + esc(t('postMax', { k: fmt(s.chargePointLimitKw, 1), by: s.chargePointLimitBy })) + '</div>';
      var rows = s.connectors.map(function (c) {
        var st = s.powerOff ? 'off' : (s.connected || s.offline ? c.status : 'off');
        var html = '<div class="conn ' + esc(st) + '"><div class="head"><strong>' + esc(t('conn', { n: c.id })) + '</strong>' +
                   '<span class="pill ' + esc(st) + '">' + esc(st) + '</span></div>';
        html += '<div class="hose' + (c.powerKw > 0 ? ' on' : '') + '"></div>';
        if (c.transactionId != null || c.powerKw > 0) {
          html += '<div class="row" style="justify-content:space-between;margin-top:4px"><span class="kw">' + fmt(c.powerKw, 1) + ' kW</span>' +
                  '<span class="small">' + fmt(c.currentA, 1) + ' A · ' + esc(t('session', { k: fmt(c.sessionWh / 1000, 2) })) + '</span></div>';
        }
        if (c.car) {
          var soc = Math.floor(c.car.soc || 0);
          html += '<div class="car"><span>🚗 ' + esc(carName(c.car)) + '</span><div class="soc"><i style="width:' + soc + '%"></i></div><span>' + soc + ' %' +
                  (c.status === 'SuspendedEV' ? ' · ' + esc(TXT.full) : '') + '</span></div>';
        }
        if (c.awaitingPlug) html += '<div class="small">' + esc(TXT.waitCard) + '</div>';
        if (c.limitKw != null) html += '<div class="lim">' + esc(t('limit', { k: fmt(c.limitKw, 1), by: c.limitBy })) + '</div>';
        var b = '';
        if (!c.plugged) {
          b += '<select data-car="' + pi + ':' + c.id + '">' + Object.keys(CARS).map(function (k) { return '<option value="' + k + '">' + esc(TXT.cars[k]) + '</option>'; }).join('') + '</select>' +
               '<button data-act="plug" data-p="' + pi + '" data-c="' + c.id + '">' + esc(TXT.plug) + '</button>';
        } else {
          b += '<button data-act="card" data-p="' + pi + '" data-c="' + c.id + '">' + esc(c.transactionId != null ? TXT.stopCard : TXT.card) + '</button>' +
               '<button data-act="unplug" data-p="' + pi + '" data-c="' + c.id + '">' + esc(TXT.unplug) + '</button>';
        }
        return html + '<div class="btns">' + b + '</div></div>';
      }).join('');
      var foot = '<div class="btns" style="margin-top:8px"><button data-act="net" data-p="' + pi + '">' + esc(TXT.netCut) + '</button>' +
                 '<button data-act="power" data-p="' + pi + '">' + esc(TXT.powerCut) + '</button></div>';
      return '<div class="card post">' + head + rows + foot + '</div>';
    }).join('');
    // Keep the car chosen in each selector across repaints
    Array.prototype.forEach.call(box.querySelectorAll('select[data-car]'), function (sel) {
      if (carChoice[sel.dataset.car]) sel.value = carChoice[sel.dataset.car];
      sel.onchange = function () { carChoice[sel.dataset.car] = sel.value; };
    });
  }
  var carChoice = {};
  $('posts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var p = posts[+b.dataset.p], cid = +b.dataset.c; if (!p) return;
    var act = b.dataset.act;
    if (act === 'plug') plugCar(p, cid, carChoice[b.dataset.p + ':' + cid] || 'small');
    else if (act === 'unplug') p.charger.unplug(cid);
    else if (act === 'card') p.charger.tapCard(p.id + '-C' + cid, cid);
    else if (act === 'net') p.charger.outage(20);
    else if (act === 'power') p.charger.powerLoss(30);
    dirty = true;
  });
  $('logf').onchange = function () { $('log').textContent = ''; };
})();
