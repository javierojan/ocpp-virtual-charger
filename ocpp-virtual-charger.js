/*!
 * ocpp-virtual-charger — an OCPP 1.6J charge point that runs in the browser or in Node.js, with no install.
 * https://github.com/javierojan/ocpp-virtual-charger · MIT License · (c) 2026 Javier Ojanguren (askacharge.com)
 *
 * It connects to any OCPP 1.6J central system (CSMS) like a real charger would: BootNotification, heartbeats,
 * status notifications, transactions with meter values, and it answers the commands it receives
 * (RemoteStart/Stop, GetConfiguration, TriggerMessage and a few more). It can also simulate a network outage:
 * it keeps charging, queues its messages and delivers them with their original timestamps when it comes back.
 *
 *   var charger = OcppVirtualCharger('wss://example.com/ocpp/CP-001', { onChange: function (state) { ... } });
 *   charger.start(); charger.stop(); charger.outage(20); charger.close();
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OcppVirtualCharger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function now() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function messageId() { return Math.random().toString(16).slice(2, 10); }

  /**
   * @param {string} url  Full OCPP URL, identity included (…/ocpp/CP-001).
   * @param {object} [options]
   *   onChange(state)            called on every state change
   *   onFrame(direction, frame)  'out' | 'in', with the raw OCPP-J frame (for logging)
   *   vendor, model, firmware    sent in BootNotification
   *   powerKw (7.4)              charging power
   *   meterIntervalSec (5)       MeterValues interval while charging
   *   heartbeatSec (60)          until the CSMS sets its own interval in the BootNotification response
   *   idTag ('VIRTUAL-CARD')     card used by start()
   *   waitForPlug (false)        RemoteStartTransaction waits for plugIn() instead of starting at once
   *   authorizationKey, securityProfile  Basic Auth (profiles 1-2). Node only: browsers can't send it. The CSMS can
   *                              also set the key with ChangeConfiguration AuthorizationKey; the charger then reconnects.
   *   createSocket(url, protocols, headers)  returns a WebSocket-like object (headers: Authorization or null).
   *                              Defaults to the global WebSocket (Node 22+ passes the headers; browsers can't).
   */
  return function OcppVirtualCharger(url, options) {
    options = options || {};
    var powerKw = options.powerKw || 7.4;
    var meterMs = (options.meterIntervalSec || 5) * 1000;
    var heartbeatMs = (options.heartbeatSec || 60) * 1000;
    var ws = null, closed = false, outage = false, rebooting = false, queue = [], pending = {}, heartbeat = null, meter = null;
    // Basic Auth (OCPP security profiles 1-2): a browser can't send it, Node can. The key can come in the options or be
    // set by the CSMS with ChangeConfiguration AuthorizationKey, which is how a platform provisions a new charger.
    var canAuth = !!options.createSocket || typeof window === 'undefined';
    var authKey = options.authorizationKey || null;
    var securityProfile = options.securityProfile != null ? options.securityProfile : (authKey ? 2 : 0);
    var identity = decodeURIComponent(String(url).replace(/\/+$/, '').split('/').pop());
    var failures = 0, inoperativeAfterSession = false;
    var state = { connected: false, status: 'Available', transactionId: null, meterWh: 125000, powerKw: 0,
                  idTag: null, plugged: false, sessionWh: 0, startedAt: null, offline: false, queued: 0, delivered: null,
                  available: true, rebooting: false, gaveUp: false };
    var waitingTag = null;   // card authorized (locally or remotely) before the cable was plugged in

    function changed() { state.awaitingPlug = !!waitingTag; if (options.onChange) try { options.onChange(state); } catch (e) {} }
    function send(frame) {
      if (options.onFrame) try { options.onFrame('out', frame); } catch (e) {}
      ws.send(JSON.stringify(frame));
    }

    function call(action, payload) {
      if (state.offline) {
        // Offline: what a real charger would report is kept, in order, for when the network comes back
        if (action === 'MeterValues' || action === 'StopTransaction' || action === 'StatusNotification') {
          queue.push([action, payload]); state.queued = queue.length; changed();
        }
        return Promise.resolve(null);
      }
      return new Promise(function (resolve) {
        var id = messageId();
        pending[id] = resolve;
        if (ws && ws.readyState === 1) send([2, id, action, payload]);
        setTimeout(function () { if (pending[id]) { delete pending[id]; resolve(null); } }, 30000);
      });
    }
    function status(s) {
      state.status = s; changed();
      return call('StatusNotification', { connectorId: 1, status: s, errorCode: 'NoError', timestamp: now() });
    }
    function sample() {
      var kw = powerKw - 0.2 + Math.random() * 0.4;
      var wh = kw * 1000 * (meterMs / 1000) / 3600;
      state.powerKw = kw; state.meterWh += wh; state.sessionWh += wh; changed();
      return call('MeterValues', { connectorId: 1, transactionId: state.transactionId, meterValue: [{ timestamp: now(), sampledValue: [
        { value: String(Math.round(state.meterWh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh', context: 'Sample.Periodic' },
        { value: String(Math.round(kw * 1000)), measurand: 'Power.Active.Import', unit: 'W', context: 'Sample.Periodic' },
        { value: (kw * 1000 / 230).toFixed(1), measurand: 'Current.Import', unit: 'A', phase: 'L1', context: 'Sample.Periodic' }
      ] }] });
    }
    function startTransaction(idTag) {
      if (state.transactionId || !state.available) return;
      state.plugged = true; waitingTag = null;
      state.idTag = idTag || options.idTag || 'VIRTUAL-CARD';
      (state.status === 'Preparing' ? Promise.resolve() : status('Preparing')).then(function () {
        return call('StartTransaction', { connectorId: 1, idTag: state.idTag, meterStart: Math.round(state.meterWh), timestamp: now() });
      }).then(function (r) {
        if (!r || r.transactionId == null || (r.idTagInfo && r.idTagInfo.status !== 'Accepted')) { status('Available'); return; }
        state.transactionId = r.transactionId; state.sessionWh = 0; state.startedAt = Date.now();
        status('Charging');
        meter = setInterval(sample, meterMs);
        sample();
      });
    }
    function stopTransaction(reason, thenUnplug) {
      if (!state.transactionId) return;
      clearInterval(meter); meter = null;
      var tx = state.transactionId; state.transactionId = null; state.powerKw = 0;
      // StopTransaction first, Available last: some CSMSs close a session as abandoned if Available arrives first
      call('StopTransaction', { transactionId: tx, meterStop: Math.round(state.meterWh), timestamp: now(), reason: reason || 'Remote' })
        .then(function () { return state.plugged ? status('Finishing') : null; })
        .then(function () {
          if (inoperativeAfterSession) { inoperativeAfterSession = false; state.available = false; if (!state.plugged) return status('Unavailable'); }
          if (thenUnplug) setTimeout(unplug, 1500); else if (!state.plugged) status(state.available ? 'Available' : 'Unavailable');
        });
    }
    function plugIn() {
      if (state.plugged) return;
      state.plugged = true; changed();
      if (!state.available) return;
      if (waitingTag) startTransaction(waitingTag);
      else if (!state.transactionId) status('Preparing');
    }
    function unplug() {
      if (!state.plugged) return;
      state.plugged = false; waitingTag = null; changed();
      if (state.transactionId) stopTransaction('EVDisconnected');
      else status(state.available ? 'Available' : 'Unavailable');
    }
    function tapCard(idTag) {
      idTag = idTag || options.idTag || 'VIRTUAL-CARD';
      if (state.transactionId) {             // same card again: stop, the cable stays in (Finishing)
        if (idTag === state.idTag) stopTransaction('Local');
        return Promise.resolve('Stopping');
      }
      return call('Authorize', { idTag: idTag }).then(function (r) {
        var ok = r && r.idTagInfo && r.idTagInfo.status === 'Accepted';
        if (!ok) return r && r.idTagInfo ? r.idTagInfo.status : 'NoAnswer';
        if (state.plugged) startTransaction(idTag); else { waitingTag = idTag; changed(); }
        return 'Accepted';
      });
    }

    var KEYS = {   // configuration keys: [readonly, getter]
      HeartbeatInterval: [false, function () { return String(heartbeatMs / 1000); }],
      MeterValueSampleInterval: [false, function () { return String(meterMs / 1000); }],
      MeterValuesSampledData: [true, function () { return 'Energy.Active.Import.Register,Power.Active.Import,Current.Import'; }],
      NumberOfConnectors: [true, function () { return '1'; }],
      StopTransactionOnEVSideDisconnect: [true, function () { return 'true'; }]
    };
    if (canAuth) KEYS.SecurityProfile = [false, function () { return String(securityProfile); }];

    function reconnectSoon() {   // after a credential or profile change: back in with the new settings
      setTimeout(function () { if (ws && ws.readyState === 1) ws.close(); }, 1500);
    }
    function changeConfiguration(key, value) {
      if (key === 'AuthorizationKey') {
        if (!canAuth) return 'NotSupported';                       // a browser can't send Basic Auth
        if (typeof value !== 'string' || value.length < 16) return 'Rejected';
        authKey = value; if (securityProfile < 1) securityProfile = 2; reconnectSoon(); return 'Accepted';
      }
      if (key === 'SecurityProfile') {
        if (!canAuth) return 'NotSupported';
        var v = parseInt(value, 10);
        if (isNaN(v) || v < securityProfile || v > 2 || !authKey) return 'Rejected';   // no downgrade; 3 needs client certificates
        securityProfile = v; reconnectSoon(); return 'Accepted';
      }
      if (key === 'HeartbeatInterval' || key === 'MeterValueSampleInterval') {
        var n = parseInt(value, 10);
        if (isNaN(n) || n < 1) return 'Rejected';
        if (key === 'HeartbeatInterval') {
          heartbeatMs = n * 1000; clearInterval(heartbeat);
          heartbeat = setInterval(function () { call('Heartbeat', {}); }, heartbeatMs);
        } else {
          meterMs = n * 1000;
          if (meter) { clearInterval(meter); meter = setInterval(sample, meterMs); }
        }
        return 'Accepted';
      }
      return KEYS[key] ? 'Rejected' : 'NotSupported';
    }

    function answer(id, action, payload) {
      var r = { status: 'Accepted' };
      if (action === 'RemoteStartTransaction') {
        r.status = state.transactionId || !state.available ? 'Rejected' : 'Accepted';
        if (r.status === 'Accepted') setTimeout(function () {
          if (state.plugged || !options.waitForPlug) startTransaction(payload.idTag); else { waitingTag = payload.idTag; changed(); }
        }, 800);
      } else if (action === 'RemoteStopTransaction') {
        r.status = state.transactionId && payload.transactionId == state.transactionId ? 'Accepted' : 'Rejected';
        if (r.status === 'Accepted') setTimeout(function () { stopTransaction('Remote'); }, 800);
      } else if (action === 'GetConfiguration') {
        var asked = payload.key && payload.key.length ? payload.key : Object.keys(KEYS);
        r = { configurationKey: [], unknownKey: [] };
        asked.forEach(function (k) {
          if (KEYS[k]) r.configurationKey.push({ key: k, readonly: KEYS[k][0], value: KEYS[k][1]() });
          else r.unknownKey.push(k);
        });
      } else if (action === 'ChangeConfiguration') {
        r.status = changeConfiguration(payload.key, payload.value);
      } else if (action === 'TriggerMessage') {
        var what = payload.requestedMessage;
        if (['Heartbeat', 'StatusNotification', 'MeterValues', 'BootNotification'].indexOf(what) < 0) r.status = 'NotImplemented';
        else setTimeout(function () {
          if (what === 'Heartbeat') call('Heartbeat', {});
          else if (what === 'StatusNotification') status(state.status);
          else if (what === 'MeterValues') {
            if (state.transactionId) sample();
            else call('MeterValues', { connectorId: 1, meterValue: [{ timestamp: now(), sampledValue: [
              { value: String(Math.round(state.meterWh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh' }] }] });
          } else boot();
        }, 500);
      } else if (action === 'ChangeAvailability') {
        var operative = payload.type === 'Operative';
        if (!operative && state.transactionId) { inoperativeAfterSession = true; r.status = 'Scheduled'; }
        else setTimeout(function () {
          state.available = operative; inoperativeAfterSession = false;
          status(!operative ? 'Unavailable' : (state.plugged ? 'Preparing' : 'Available'));
        }, 300);
      } else if (action === 'UnlockConnector') {
        r = { status: 'Unlocked' };
        setTimeout(function () { if (state.transactionId) stopTransaction('UnlockCommand'); unplugQuietly(); }, 300);
      } else if (action === 'Reset') {
        setTimeout(function () { reboot(payload.type === 'Hard' ? 'HardReset' : 'SoftReset'); }, 500);
      } else if (action === 'ClearCache') {
        // Nothing cached: accepted, honestly
      } else {
        send([4, id, 'NotImplemented', 'Not implemented by the virtual charger', {}]);
        return;
      }
      send([3, id, r]);
    }

    function unplugQuietly() {   // the cable is released; the driver pulls it out
      if (!state.plugged) return;
      state.plugged = false; waitingTag = null; changed();
      if (!state.transactionId) status(state.available ? 'Available' : 'Unavailable');
    }

    function reboot(reason) {
      if (state.transactionId) stopTransaction(reason);
      setTimeout(function () {
        rebooting = true; state.rebooting = true; changed();
        if (ws) ws.close();
        setTimeout(function () { rebooting = false; state.rebooting = false; if (!closed) connect(); }, 5000);
      }, 800);
    }

    function boot() {
      return call('BootNotification', { chargePointVendor: options.vendor || 'ocpp-virtual-charger',
        chargePointModel: options.model || 'Virtual charger', firmwareVersion: options.firmware || '1.0' })
        .then(function (r) {
          if (r && r.interval > 0) heartbeatMs = r.interval * 1000;
          return r;
        });
    }

    function basicAuth() {
      if (!authKey || securityProfile < 1) return null;
      var raw = identity + ':' + authKey;
      return 'Basic ' + (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(raw))) : Buffer.from(raw).toString('base64'));
    }
    function connect() {
      var auth = basicAuth(), headers = auth ? { Authorization: auth } : null;
      var opened = false;
      if (options.createSocket) ws = options.createSocket(url, ['ocpp1.6'], headers);
      else if (headers && typeof window === 'undefined') ws = new WebSocket(url, { protocols: ['ocpp1.6'], headers: headers });
      else ws = new WebSocket(url, ['ocpp1.6']);
      ws.onopen = function () {
        opened = true; failures = 0; state.gaveUp = false;
        state.connected = true; state.offline = false; changed();
        boot()
          .then(function () {
            // What was kept offline goes first, in order and with its original timestamps
            var backlog = queue.splice(0), n = backlog.length;
            return backlog.reduce(function (p, m) { return p.then(function () { return call(m[0], m[1]); }); }, Promise.resolve())
              .then(function () { if (n) { state.delivered = n; state.queued = 0; changed(); } });
          })
          .then(function () {
            status(state.transactionId ? 'Charging' : (state.plugged ? state.status : 'Available'));
            // Back while charging: keep metering, and send a reading now so the CSMS knows the running transaction
            if (state.transactionId && !meter) { meter = setInterval(sample, meterMs); sample(); }
            clearInterval(heartbeat);
            heartbeat = setInterval(function () { call('Heartbeat', {}); }, heartbeatMs);
          });
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (options.onFrame) try { options.onFrame('in', m); } catch (x) {}
        if (m[0] === 3 && pending[m[1]]) { var ok = pending[m[1]]; delete pending[m[1]]; ok(m[2]); }
        else if (m[0] === 4 && pending[m[1]]) { var ko = pending[m[1]]; delete pending[m[1]]; ko(null); }
        else if (m[0] === 2) answer(m[1], m[2], m[3] || {});
      };
      ws.onclose = function () {
        state.connected = false; changed();
        clearInterval(heartbeat);
        if (outage) return;   // simulated outage: keeps charging and metering until the network is back
        clearInterval(meter); meter = null;
        if (rebooting || closed) return;
        // Turned away at the handshake (wrong address, missing or wrong key): back off, and after 5 refusals in a row
        // stop, instead of knocking every 3 s and setting off the CSMS's "rejected charger" alerts.
        if (!opened && ++failures >= 5) { state.gaveUp = true; changed(); return; }
        setTimeout(connect, opened ? 3000 : 3000 * Math.pow(2, failures - 1));
      };
    }

    connect();
    return {
      state: state,
      /** Local start, as if a card had been tapped with the cable already in. */
      start: function (idTag) { startTransaction(idTag); },
      /** Local stop; the cable is pulled out right after. */
      stop: function () { stopTransaction('Local', true); },
      /** Plug the car in: Preparing, or starts at once if a card was authorized before. */
      plugIn: plugIn,
      /** Pull the cable out: ends the running session (EVDisconnected) and goes back to Available. */
      unplug: unplug,
      /** Tap a card on the reader: Authorize, then start (cable in) or wait for the cable; the same card stops. */
      tapCard: tapCard,
      /** Simulate a network outage of `seconds`: keeps charging, queues messages, delivers them on reconnect. */
      outage: function (seconds) {
        if (!ws || ws.readyState !== 1 || outage) return;
        outage = true; state.offline = true; state.delivered = null; queue = []; state.queued = 0; changed();
        ws.close();
        setTimeout(function () { outage = false; if (!closed) connect(); }, (seconds || 20) * 1000);
      },
      /** Try again after giving up (state.gaveUp). */
      retry: function () { if (!closed && state.gaveUp) { failures = 0; state.gaveUp = false; changed(); connect(); } },
      /** Disconnect for good. */
      close: function () { closed = true; clearInterval(heartbeat); clearInterval(meter); if (ws) ws.close(); }
    };
  };
});
