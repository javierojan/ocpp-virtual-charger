// The demo page (index.html): a drawn wall charger driven by ocpp-virtual-charger.js.
// Kept out of the HTML so the page also works under a strict Content-Security-Policy (script-src 'self').
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ES = /^es\b/i.test(navigator.language || '') || /[?&]lang=es\b/.test(location.search);

  var TXT = ES ? {
    title: 'Cargador virtual OCPP', lead: 'Un cargador de pared que vive en esta pestaña. Enchufa el coche, pasa la tarjeta y míralo cargar, mientras cada mensaje OCPP va a un servidor de verdad.',
    plug: 'Enchufar el coche', unplug: 'Desenchufar', card: 'Pasar la tarjeta', outage: 'Corte de red (20 s)',
    on: 'Encender el cargador', autohelp: 'Se conecta al servidor de pruebas gratuito de askacharge.com. Puedes ver en directo lo que recibe el servidor:',
    watch: 'Verlo en el servidor de pruebas →', own: 'Usar mi propio CSMS', urllabel: 'Dirección OCPP, acabada en la identidad del cargador',
    connect: 'Conectar', manualhelp: '¿Sin CSMS? El servidor de pruebas OCPP de askacharge.com te da una dirección gratis y sin cuenta. Desde el navegador no se puede mandar contraseña (Basic Auth): usa un CSMS que acepte el cargador sin ella, o lánzalo desde Node.',
    'k-conn': 'Conexión', 'k-status': 'Estado OCPP', 'k-tx': 'Transacción', 'k-queue': 'En cola sin red', frames: 'Mensajes OCPP',
    madeby: 'Hecho por', platform: 'plataforma de gestión de cargadores con estándares abiertos.',
    connected: 'Conectado', reconnecting: 'Reconectando…', offline: 'Sin red', off: 'Apagado',
    sOff: ['Apagado', '', ''], sNet: ['Sin conexión', 'Reintentando…', ''],
    sAvail: ['Disponible', 'Enchufe el coche', 'o pase su tarjeta'], sPrep: ['Pase su tarjeta', 'para empezar', ''],
    sAuth: ['Tarjeta aceptada', 'Enchufe el coche', ''], sChg: ['Cargando', '', ''], sFin: ['Carga terminada', '', 'Retire el cable'],
    sBad: ['Tarjeta no válida', '', ''], sOut: ['Sin red', 'sigue cargando', ''],
    sUnav: ['Fuera de servicio', '', ''], sBoot: ['Reiniciando…', '', ''], sGave: ['Rechazado', 'por el servidor', ''],
    hGave: 'El servidor no deja entrar a este cargador. Si lo aceptaste con clave: un navegador no puede mandarla, déjalo en pruebas sin clave. Si no, revisa la dirección.',
    hUnav: 'Fuera de servicio por orden del panel (ChangeAvailability).', retry: 'Reintentar',
    hOff: 'Enciende el cargador para empezar.', hAvail: 'Enchufa el coche (o pulsa sobre él) y pasa la tarjeta.',
    hPrep: 'Ahora pasa la tarjeta por el lector.', hAuth: 'Tarjeta aceptada: enchufa el coche.', hChg: 'Cargando. Pasa la misma tarjeta para parar, o desenchufa.',
    hFin: 'Carga terminada: desenchufa el coche.', hOut: 'Corte de red: sigue cargando y guarda los mensajes para cuando vuelva.',
    queued: ' mensajes', delivered: ' entregados'
  } : {
    plug: 'Plug the car in', unplug: 'Unplug', card: 'Tap the card', outage: 'Network outage (20 s)',
    connected: 'Connected', reconnecting: 'Reconnecting…', offline: 'Offline', off: 'Off',
    sOff: ['Off', '', ''], sNet: ['No connection', 'Retrying…', ''],
    sAvail: ['Available', 'Plug the car in', 'or tap your card'], sPrep: ['Tap your card', 'to start', ''],
    sAuth: ['Card accepted', 'Plug the car in', ''], sChg: ['Charging', '', ''], sFin: ['Session ended', '', 'Unplug the cable'],
    sBad: ['Card not valid', '', ''], sOut: ['Offline', 'still charging', ''],
    sUnav: ['Out of service', '', ''], sBoot: ['Rebooting…', '', ''], sGave: ['Rejected', 'by the server', ''],
    hGave: 'The server won\'t let this charger in. If you accepted it with a key: a browser can\'t send it, keep it in testing without a key. Otherwise, check the address.',
    hUnav: 'Out of service, by order of the CSMS (ChangeAvailability).', retry: 'Try again',
    hOff: 'Switch the charger on to start.', hAvail: 'Plug the car in (or click it) and tap the card.',
    hPrep: 'Now tap the card on the reader.', hAuth: 'Card accepted: plug the car in.', hChg: 'Charging. Tap the same card to stop, or unplug.',
    hFin: 'Session ended: unplug the car.', hOut: 'Network outage: it keeps charging and queues its messages for when it is back.',
    queued: ' messages', delivered: ' delivered'
  };
  if (ES) {
    document.documentElement.lang = 'es';
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) {
      if (TXT[el.dataset.t]) el.textContent = TXT[el.dataset.t];
    });
  }

  var CABLE_OUT = 'M145 266 C 145 330, 120 345, 110 300';
  var CABLE_IN = 'M145 266 C 170 372, 560 372, 602 256';
  var charger = null, flash = null, lastStatus = null;

  // On askacharge.com the page can ask the test server for a free code; anywhere else, you type your own URL.
  var HOSTED = location.hostname === 'askacharge.com';
  $(HOSTED ? 'auto' : 'manual').hidden = false;
  try { $('url').value = localStorage.getItem('ovc-url') || ''; } catch (e) {}
  $('own').onclick = function (e) { e.preventDefault(); $('auto').hidden = true; $('manual').hidden = false; };

  function fmt(n, d) { return n.toLocaleString(ES ? 'es-ES' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function clock(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

  function log(dir, frame) {
    var line = document.createElement('div');
    line.className = dir;
    line.textContent = new Date().toLocaleTimeString() + (dir === 'out' ? '  →  ' : '  ←  ') + JSON.stringify(frame);
    var box = $('log');
    box.appendChild(line);
    while (box.childNodes.length > 400) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function screen(lines) {
    $('scr1').textContent = lines[0] || ' '; $('scr2').textContent = lines[1] || ' '; $('scr3').textContent = lines[2] || ' ';
  }

  function paint() {
    var s = charger ? charger.state : null;
    var scene = $('scene');
    var cls = !s ? 'off' : (s.connected || s.offline ? s.status : 'off');
    scene.setAttribute('class', 'scene st-' + cls);
    $('cable').setAttribute('d', s && s.plugged ? CABLE_IN : CABLE_OUT);

    var lines, hint;
    if (!s) { lines = TXT.sOff; hint = TXT.hOff; }
    else if (flash) { lines = flash; hint = $('hint').textContent; }
    else if (s.gaveUp) { lines = TXT.sGave; hint = TXT.hGave; }
    else if (s.rebooting) { lines = TXT.sBoot; hint = ''; }
    else if (s.offline) { lines = [TXT.sOut[0], TXT.sOut[1], fmt(s.sessionWh / 1000, 2) + ' kWh']; hint = TXT.hOut; }
    else if (!s.connected) { lines = TXT.sNet; hint = ''; }
    else if (s.status === 'Charging') {
      lines = [TXT.sChg[0], fmt(s.powerKw, 1) + ' kW · ' + fmt(s.sessionWh / 1000, 2) + ' kWh', clock(Date.now() - (s.startedAt || Date.now()))];
      hint = TXT.hChg;
    } else if (s.status === 'Finishing') { lines = [TXT.sFin[0], fmt(s.sessionWh / 1000, 2) + ' kWh', TXT.sFin[2]]; hint = TXT.hFin; }
    else if (s.status === 'Unavailable') { lines = TXT.sUnav; hint = TXT.hUnav; }
    else if (s.awaitingPlug) { lines = TXT.sAuth; hint = TXT.hAuth; }
    else if (s.status === 'Preparing') { lines = TXT.sPrep; hint = TXT.hPrep; }
    else { lines = TXT.sAvail; hint = TXT.hAvail; }
    screen(lines);
    $('hint').textContent = hint || ' ';

    // Battery: the text is the real energy of the session; the bar is just there to show it filling up
    var kwh = s ? s.sessionWh / 1000 : 0;
    $('batfill').setAttribute('width', String(Math.max(4, Math.min(64, 8 + kwh * 300))));
    $('batpct').textContent = '+' + fmt(kwh, 2) + ' kWh';

    var on = !!s;
    $('b-plug').disabled = !on || !s.connected && !s.offline;
    $('b-card').disabled = !on || !s.connected;
    $('b-outage').disabled = !on || !s.connected;
    $('b-plug').textContent = s && s.plugged ? TXT.unplug : TXT.plug;
    $('b-retry').hidden = !(s && s.gaveUp);

    $('s-conn').textContent = !s ? TXT.off : (s.offline ? TXT.offline : (s.connected ? TXT.connected : TXT.reconnecting));
    $('s-status').textContent = s ? s.status : '—';
    $('s-tx').textContent = s && s.transactionId != null ? String(s.transactionId) : '—';
    $('s-queue').textContent = !s ? '—' : (s.queued ? s.queued + TXT.queued : (s.delivered ? s.delivered + TXT.delivered : '—'));
    lastStatus = s && s.status;
  }

  function start(url) {
    if (charger) charger.close();
    $('log').textContent = '';
    charger = OcppVirtualCharger(url, { onChange: paint, onFrame: log, waitForPlug: true,
      model: ES ? 'Cargador virtual (navegador)' : 'Virtual charger (browser)' });
    paint();
  }

  $('b-on').onclick = function () {
    var b = this; b.disabled = true;
    fetch('/askacharge/ocpp-test/api/nuevo', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.codigo) throw new Error('no code');
      var id = 'VIRTUAL-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      start('wss://askacharge.com/askacharge/ocpp-test/' + d.codigo + '/' + id);
      var w = $('watch');
      w.href = '/askacharge/' + (ES ? 'probar-ocpp.html' : 'en/ocpp-test-server.html') + '?c=' + d.codigo + '&src=virtual-charger';
      w.hidden = false;
      b.hidden = true;
    }).catch(function () { b.disabled = false; $('auto').hidden = true; $('manual').hidden = false; });
  };
  $('b-connect').onclick = function () {
    var url = $('url').value.trim();
    if (!/^wss?:\/\/.+\/[^/]+$/.test(url)) { $('url').focus(); return; }
    try { localStorage.setItem('ovc-url', url); } catch (e) {}
    start(url);
  };

  function togglePlug() {
    if (!charger) return;
    if (charger.state.plugged) charger.unplug(); else charger.plugIn();
  }
  function tap() {
    if (!charger || !charger.state.connected) return;
    var card = $('rfidcard');
    card.classList.add('tap');
    setTimeout(function () { card.classList.remove('tap'); }, 700);
    charger.tapCard().then(function (r) {
      if (r && r !== 'Accepted' && r !== 'Stopping') {
        flash = TXT.sBad.slice(); flash[1] = r; paint();
        setTimeout(function () { flash = null; paint(); }, 2000);
      }
    });
  }
  $('b-plug').onclick = togglePlug;
  $('car').addEventListener('click', togglePlug);
  $('cable').addEventListener('click', togglePlug);
  $('b-card').onclick = tap;
  $('rfidcard').addEventListener('click', tap);
  $('b-outage').onclick = function () { if (charger) charger.outage(20); };
  $('b-retry').onclick = function () { if (charger) charger.retry(); };

  setInterval(function () { if (charger && charger.state.status === 'Charging') paint(); }, 1000);   // the clock on the screen
  paint();
})();
