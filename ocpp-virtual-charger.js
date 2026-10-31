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
 *   createSocket(url, protocols)  returns a WebSocket-like object; use it to pass headers in Node
   *                              (e.g. Basic Auth with the `ws` package). Defaults to the global WebSocket.
   */
  return function OcppVirtualCharger(url, options) {
    options = options || {};
    var powerKw = options.powerKw || 7.4;
    var meterMs = (options.meterIntervalSec || 5) * 1000;
    var heartbeatMs = (options.heartbeatSec || 60) * 1000;
    var ws = null, closed = false, outage = false, queue = [], pending = {}, heartbeat = null, meter = null;
    var state = { connected: false, status: 'Available', transactionId: null, meterWh: 125000, powerKw: 0,
                  idTag: null, plugged: false, sessionWh: 0, startedAt: null, offline: false, queued: 0, delivered: null };
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
      if (state.transactionId) return;
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
        .then(function () { if (thenUnplug) setTimeout(unplug, 1500); else if (!state.plugged) status('Available'); });
    }
    function plugIn() {
      if (state.plugged) return;
      state.plugged = true; changed();
      if (waitingTag) startTransaction(waitingTag);
      else if (!state.transactionId) status('Preparing');
    }
    function unplug() {
      if (!state.plugged) return;
      state.plugged = false; waitingTag = null; changed();
      if (state.transactionId) stopTransaction('EVDisconnected');
      else status('Available');
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

    function answer(id, action, payload) {
      var r = { status: 'Accepted' };
      if (action === 'RemoteStartTransaction') {
        r.status = state.transactionId ? 'Rejected' : 'Accepted';
        if (!state.transactionId) setTimeout(function () {
          if (state.plugged || !options.waitForPlug) startTransaction(payload.idTag); else { waitingTag = payload.idTag; changed(); }
        }, 800);
      } else if (action === 'RemoteStopTransaction') {
        r.status = state.transactionId && payload.transactionId == state.transactionId ? 'Accepted' : 'Rejected';
        if (r.status === 'Accepted') setTimeout(function () { stopTransaction('Remote'); }, 800);
      } else if (action === 'GetConfiguration') {
        r = { configurationKey: [
          { key: 'HeartbeatInterval', readonly: false, value: String(heartbeatMs / 1000) },
          { key: 'MeterValueSampleInterval', readonly: false, value: String(meterMs / 1000) },
          { key: 'MeterValuesSampledData', readonly: false, value: 'Energy.Active.Import.Register,Power.Active.Import,Current.Import' },
          { key: 'NumberOfConnectors', readonly: true, value: '1' },
          { key: 'StopTransactionOnEVSideDisconnect', readonly: false, value: 'true' }] };
      } else if (action === 'TriggerMessage') {
        var what = payload.requestedMessage;
        setTimeout(function () {
          if (what === 'Heartbeat') call('Heartbeat', {});
          else if (what === 'StatusNotification') status(state.status);
          else if (what === 'MeterValues') {
            if (state.transactionId) sample();
            else call('MeterValues', { connectorId: 1, meterValue: [{ timestamp: now(), sampledValue: [
              { value: String(Math.round(state.meterWh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh' }] }] });
          } else if (what === 'BootNotification') boot();
        }, 500);
      } else if (action === 'UnlockConnector') {
        r = { status: 'Unlocked' };
      } else if (action === 'ChangeConfiguration' || action === 'ChangeAvailability' || action === 'Reset' || action === 'ClearCache') {
        // Acknowledged, not acted upon: this is a simulator, not a full implementation
      } else {
        send([4, id, 'NotImplemented', 'Not implemented by the virtual charger', {}]);
        return;
      }
      send([3, id, r]);
    }

    function boot() {
      return call('BootNotification', { chargePointVendor: options.vendor || 'ocpp-virtual-charger',
        chargePointModel: options.model || 'Virtual charger', firmwareVersion: options.firmware || '1.0' })
        .then(function (r) {
          if (r && r.interval > 0) heartbeatMs = r.interval * 1000;
          return r;
        });
    }

    function connect() {
      ws = options.createSocket ? options.createSocket(url, ['ocpp1.6']) : new WebSocket(url, ['ocpp1.6']);
      ws.onopen = function () {
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
        if (!closed) setTimeout(connect, 3000);   // reconnect on its own, like real hardware
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
      /** Disconnect for good. */
      close: function () { closed = true; clearInterval(heartbeat); clearInterval(meter); if (ws) ws.close(); }
    };
  };
});
