/*!
 * ocpp-virtual-charger — an OCPP 1.6J charge point that runs in the browser or in Node.js, with no install.
 * https://github.com/javierojan/ocpp-virtual-charger · MIT License · (c) 2026 Javier Ojanguren (askacharge.com)
 *
 * It connects to any OCPP 1.6J central system (CSMS) like a real charger would: BootNotification, heartbeats,
 * status notifications, transactions with meter values, and it answers the commands it receives. It can have
 * several connectors, obeys Smart Charging profiles (SetChargingProfile, ClearChargingProfile,
 * GetCompositeSchedule) and models the car on each connector (battery, state of charge, what it accepts).
 * It can also simulate a network outage: it keeps charging, queues its messages and delivers them with their
 * original timestamps when it comes back.
 *
 *   var charger = OcppVirtualCharger('wss://example.com/ocpp/CP-001', { connectors: 2, powerKw: 22 });
 *   charger.plugIn(1, { batteryKwh: 60, soc: 30, maxAcKw: 11 }); charger.tapCard('CARD-1', 1);
 *   charger.outage(20); charger.close();
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OcppVirtualCharger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VOLTS = 230;          // phase voltage (AC)
  var DC_VOLTS = 400;       // battery voltage used to express DC current
  var MIN_AMPS = 6;         // IEC 61851: an AC car cannot charge below 6 A per phase
  var MIN_DC_KW = 1;        // below this a DC charger pauses
  var TICK_MS = 1000;       // physics step: energy, state of charge, limits

  function now() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function messageId() { return Math.random().toString(16).slice(2, 10); }
  function round(x, n) { var f = Math.pow(10, n || 0); return Math.round(x * f) / f; }
  function parseTime(s) { var t = Date.parse(s); return isNaN(t) ? null : t; }

  // How a rated power is delivered: AC up to 7.4 kW on one phase, AC up to 22 kW on three, DC above.
  function supplyOf(kw) { return kw > 22 ? 'DC' : (kw > 7.4 ? 'AC3' : 'AC1'); }
  function phasesOf(supply) { return supply === 'AC3' ? 3 : (supply === 'AC1' ? 1 : 0); }

  /**
   * @param {string} url  Full OCPP URL, identity included (…/ocpp/CP-001).
   * @param {object} [options]
   *   connectors (1)             number of connectors (outlets or cables)
   *   powerKw (7.4)              rated power of each connector. Up to 7.4 one-phase AC, up to 22 three-phase AC, above DC
   *   chargerMaxKw               what the whole charge point can deliver at once (default: powerKw × connectors)
   *   onChange(state)            called on every state change
   *   onFrame(direction, frame)  'out' | 'in', with the raw OCPP-J frame (for logging)
   *   vendor, model, firmware    sent in BootNotification
   *   meterIntervalSec (5)       MeterValues interval while charging
   *   heartbeatSec (60)          until the CSMS sets its own interval in the BootNotification response
   *   idTag ('VIRTUAL-CARD')     card used by start()
   *   waitForPlug (false)        RemoteStartTransaction waits for plugIn() instead of starting at once
   *   socSpeed (1)               how much faster the cars' batteries fill than real time (the meter is never sped up)
   *   authorizationKey, securityProfile  Basic Auth (profiles 1-2). Node only: browsers can't send it. The CSMS can
   *                              also set the key with ChangeConfiguration AuthorizationKey; the charger then reconnects.
   *   createSocket(url, protocols, headers)  returns a WebSocket-like object (headers: Authorization or null).
   *                              Defaults to the global WebSocket (Node 22+ passes the headers; browsers can't).
   */
  return function OcppVirtualCharger(url, options) {
    options = options || {};
    var nConn = Math.max(1, Math.min(8, parseInt(options.connectors, 10) || 1));
    var powerKw = options.powerKw || 7.4;
    var chargerMaxKw = options.chargerMaxKw || null;          // null: powerKw × connectors
    var socSpeed = options.socSpeed || 1;
    var meterMs = (options.meterIntervalSec || 5) * 1000;
    var heartbeatMs = (options.heartbeatSec || 60) * 1000;
    var ws = null, closed = false, outage = false, rebooting = false, queue = [], pending = {}, heartbeat = null, meter = null, tick = null;
    // Basic Auth (OCPP security profiles 1-2): a browser can't send it, Node can. The key can come in the options or be
    // set by the CSMS with ChangeConfiguration AuthorizationKey, which is how a platform provisions a new charger.
    var canAuth = !!options.createSocket || typeof window === 'undefined';
    var authKey = options.authorizationKey || null;
    var securityProfile = options.securityProfile != null ? options.securityProfile : (authKey ? 2 : 0);
    var identity = decodeURIComponent(String(url).replace(/\/+$/, '').split('/').pop());
    var failures = 0;
    var profiles = [];   // installed charging profiles: { connectorId, profile, installedAt }

    function newConnector(id) {
      return { id: id, status: 'Available', transactionId: null, meterWh: 125000 + (id - 1) * 37000, powerKw: 0,
               currentA: 0, idTag: null, plugged: false, sessionWh: 0, startedAt: null, available: true,
               inoperativeAfterSession: false, waitingTag: null, awaitingPlug: false, car: null,
               limitKw: null, limitBy: null, txStartedAt: null };
    }
    var conns = [];
    for (var i = 1; i <= nConn; i++) conns.push(newConnector(i));
    function conn(c) { return conns[(c || 1) - 1] || null; }

    // `state` keeps the single-connector shape (connector 1 at the top level) so simple pages keep working;
    // `state.connectors` has every connector.
    var state = { connected: false, offline: false, queued: 0, delivered: null, rebooting: false, gaveUp: false,
                  ratedKw: powerKw, chargerMaxKw: maxTotalKw(), supply: supplyOf(powerKw), totalKw: 0,
                  connectors: conns, profiles: profiles };

    function maxTotalKw() { return chargerMaxKw || powerKw * nConn; }
    function changed() {
      var c1 = conns[0];
      ['status', 'transactionId', 'meterWh', 'powerKw', 'idTag', 'plugged', 'sessionWh', 'startedAt', 'available',
       'car', 'limitKw', 'limitBy', 'currentA'].forEach(function (k) { state[k] = c1[k]; });
      conns.forEach(function (c) { c.awaitingPlug = !!c.waitingTag; });
      state.awaitingPlug = c1.awaitingPlug;
      state.totalKw = round(conns.reduce(function (s, c) { return s + c.powerKw; }, 0), 2);
      state.ratedKw = powerKw; state.chargerMaxKw = maxTotalKw(); state.supply = supplyOf(powerKw);
      if (options.onChange) try { options.onChange(state); } catch (e) {}
    }
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
    function status(c, s) {
      c.status = s; changed();
      return call('StatusNotification', { connectorId: c.id, status: s, errorCode: 'NoError', timestamp: now() });
    }
    function idleStatus(c) { return !c.available ? 'Unavailable' : (c.plugged ? 'Preparing' : 'Available'); }

    // ── Smart Charging (OCPP 1.6 §3.13) ─────────────────────────────────────────────────────────────────
    // Purposes: ChargePointMaxProfile (connector 0, caps the whole charge point), TxDefaultProfile (connector 0 =
    // every connector, or one connector, which then wins over connector 0) and TxProfile (one running transaction,
    // wins over TxDefault). Inside a purpose the highest stackLevel that is valid and in its schedule wins.

    function scheduleStart(p, c, t) {
      var cs = p.chargingSchedule || {};
      if (p.chargingProfileKind === 'Relative') return c && c.txStartedAt ? c.txStartedAt : t;
      var start = parseTime(cs.startSchedule) || p._installedAt;
      if (p.chargingProfileKind === 'Recurring') {
        var period = p.recurrencyKind === 'Weekly' ? 7 * 86400000 : 86400000;
        if (t >= start) start += Math.floor((t - start) / period) * period;
      }
      return start;
    }
    // Limit of one profile at time t, in watts, or null when the profile says nothing at that moment.
    function profileWattsAt(p, c, t, phasesAvail) {
      if (p.validFrom && t < parseTime(p.validFrom)) return null;
      if (p.validTo && t >= parseTime(p.validTo)) return null;
      var cs = p.chargingSchedule || {}, start = scheduleStart(p, c, t), el = (t - start) / 1000;
      if (el < 0) return null;
      if (cs.duration && el >= cs.duration) return null;
      var per = null;
      (cs.chargingSchedulePeriod || []).forEach(function (x) { if (x.startPeriod <= el && (!per || x.startPeriod >= per.startPeriod)) per = x; });
      if (!per) return null;
      if (cs.chargingRateUnit === 'W') return per.limit;
      if (!phasesAvail) return per.limit * DC_VOLTS;     // DC: amps at the battery
      var ph = Math.min(phasesAvail, per.numberPhases || 3);
      return per.limit * VOLTS * ph;
    }
    function best(list, c, t, phasesAvail) {
      var top = null, w = null;
      list.forEach(function (e) {
        var v = profileWattsAt(e.profile, c, t, phasesAvail);
        if (v != null && (!top || e.profile.stackLevel > top.profile.stackLevel)) { top = e; w = v; }
      });
      return top ? { watts: w, entry: top } : null;
    }
    function phasesFor(c) {
      var ph = phasesOf(supplyOf(powerKw));
      if (ph && c && c.car && c.car.phases) ph = Math.min(ph, c.car.phases);
      return ph;
    }
    // Connector limit from TxProfile / TxDefaultProfile at time t (watts), and which profile set it.
    function connectorLimit(c, t) {
      var ph = phasesFor(c);
      var tx = c.transactionId != null ? best(profiles.filter(function (e) {
        return e.profile.chargingProfilePurpose === 'TxProfile' && e.connectorId === c.id;
      }), c, t, ph) : null;
      if (tx) return { watts: tx.watts, by: 'TxProfile #' + tx.entry.profile.chargingProfileId };
      var own = best(profiles.filter(function (e) {
        return e.profile.chargingProfilePurpose === 'TxDefaultProfile' && e.connectorId === c.id;
      }), c, t, ph);
      if (own) return { watts: own.watts, by: 'TxDefaultProfile #' + own.entry.profile.chargingProfileId };
      var all = best(profiles.filter(function (e) {
        return e.profile.chargingProfilePurpose === 'TxDefaultProfile' && e.connectorId === 0;
      }), c, t, ph);
      if (all) return { watts: all.watts, by: 'TxDefaultProfile #' + all.entry.profile.chargingProfileId };
      return null;
    }
    function chargePointLimit(t) {
      var b = best(profiles.filter(function (e) { return e.profile.chargingProfilePurpose === 'ChargePointMaxProfile'; }),
                   null, t, phasesOf(supplyOf(powerKw)));
      return b ? { watts: b.watts, by: 'ChargePointMaxProfile #' + b.entry.profile.chargingProfileId } : null;
    }

    function setChargingProfile(cid, p) {
      if (!p || !p.chargingSchedule || !(p.chargingSchedule.chargingSchedulePeriod || []).length) return 'Rejected';
      if (cid < 0 || cid > nConn) return 'Rejected';
      var purpose = p.chargingProfilePurpose;
      if (purpose === 'ChargePointMaxProfile' && cid !== 0) return 'Rejected';
      if (purpose === 'TxProfile') {
        var c = conn(cid);
        if (!cid || !c || c.transactionId == null) return 'Rejected';                       // needs a running transaction
        if (p.transactionId != null && p.transactionId != c.transactionId) return 'Rejected';
      }
      if (['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile'].indexOf(purpose) < 0) return 'Rejected';
      if (['A', 'W'].indexOf(p.chargingSchedule.chargingRateUnit) < 0) return 'Rejected';
      if (p.stackLevel > 10 || (p.chargingSchedule.chargingSchedulePeriod || []).length > 24) return 'Rejected';
      // Same id replaces; same purpose + stackLevel on the same connector replaces too
      for (var k = profiles.length - 1; k >= 0; k--) {
        var e = profiles[k].profile;
        if (e.chargingProfileId === p.chargingProfileId ||
            (profiles[k].connectorId === cid && e.chargingProfilePurpose === purpose && e.stackLevel === p.stackLevel)) profiles.splice(k, 1);
      }
      if (profiles.length >= 20) return 'Rejected';
      var copy = JSON.parse(JSON.stringify(p)); copy._installedAt = Date.now();
      profiles.push({ connectorId: cid, profile: copy });
      setTimeout(physics, 50);
      return 'Accepted';
    }
    function clearChargingProfile(q) {
      var n = profiles.length;
      for (var k = profiles.length - 1; k >= 0; k--) {
        var e = profiles[k];
        if (q.id != null) { if (e.profile.chargingProfileId === q.id) profiles.splice(k, 1); continue; }
        if (q.connectorId != null && e.connectorId !== q.connectorId) continue;
        if (q.chargingProfilePurpose && e.profile.chargingProfilePurpose !== q.chargingProfilePurpose) continue;
        if (q.stackLevel != null && e.profile.stackLevel !== q.stackLevel) continue;
        profiles.splice(k, 1);
      }
      if (profiles.length !== n) setTimeout(physics, 50);
      return profiles.length !== n ? 'Accepted' : 'Unknown';
    }
    function dropTxProfiles(c) {
      for (var k = profiles.length - 1; k >= 0; k--) {
        if (profiles[k].profile.chargingProfilePurpose === 'TxProfile' && profiles[k].connectorId === c.id) profiles.splice(k, 1);
      }
    }
    // What the charger would allow, from now until now + duration: limits of the profiles combined, as periods.
    function compositeSchedule(cid, duration, unit) {
      var t0 = Date.now(), end = t0 + duration * 1000, cuts = [t0];
      profiles.forEach(function (e) {
        var p = e.profile, c = conn(e.connectorId);
        var start = scheduleStart(p, c, t0), cs = p.chargingSchedule;
        (cs.chargingSchedulePeriod || []).forEach(function (x) { cuts.push(start + x.startPeriod * 1000); });
        if (cs.duration) cuts.push(start + cs.duration * 1000);
        if (p.validFrom) cuts.push(parseTime(p.validFrom)); if (p.validTo) cuts.push(parseTime(p.validTo));
      });
      cuts = cuts.filter(function (t) { return t >= t0 && t < end; }).sort(function (a, b) { return a - b; });
      var c = cid ? conn(cid) : null, ph = phasesFor(c) || 3, toUnit = unit === 'W' ? 1 : (phasesOf(supplyOf(powerKw)) ? VOLTS * ph : DC_VOLTS);
      var periods = [], last = null;
      cuts.forEach(function (t) {
        var cap = maxTotalKw() * 1000, cp = chargePointLimit(t); if (cp) cap = Math.min(cap, cp.watts);
        if (c) { var cl = connectorLimit(c, t); cap = Math.min(cap, powerKw * 1000, cl ? cl.watts : Infinity); }
        var v = round(cap / toUnit, 1);
        if (v !== last) { periods.push({ startPeriod: Math.round((t - t0) / 1000), limit: v, numberPhases: unit === 'W' ? undefined : ph }); last = v; }
      });
      periods.forEach(function (p) { if (p.numberPhases === undefined) delete p.numberPhases; });
      return { status: 'Accepted', connectorId: cid, scheduleStart: new Date(t0).toISOString().replace(/\.\d{3}Z$/, 'Z'),
               chargingSchedule: { duration: duration, chargingRateUnit: unit === 'W' ? 'W' : 'A', chargingSchedulePeriod: periods } };
    }

    // ── The car ────────────────────────────────────────────────────────────────────────────────────────
    // car: { batteryKwh, soc (%), targetSoc (%), maxAcKw, maxDcKw, phases }. Without a car the connector takes
    // its full rating forever (the classic simulator). AC cars hold their power up to ~90 % and taper to the target;
    // DC cars taper from ~60 % (simplified curves: this is a simulator, not a battery model).
    function carAcceptsKw(c) {
      var car = c.car; if (!car) return Infinity;
      var target = car.targetSoc || 100, soc = car.soc != null ? car.soc : 50;
      if (soc >= target) return 0;
      var dc = supplyOf(powerKw) === 'DC';
      var max = dc ? (car.maxDcKw || 100) : (car.maxAcKw || 11);
      var knee = dc ? 60 : 90;
      if (soc > knee) max *= Math.max(0.08, (target - soc) / Math.max(1, target - knee));
      return max;
    }

    // ── Physics: every connector's power from rating, car, profiles and the charge point's cap ─────────
    function physics() {
      var t = Date.now();
      var active = conns.filter(function (c) { return c.transactionId != null; });
      // 1) What each connector could take on its own
      active.forEach(function (c) {
        var lim = connectorLimit(c, t);
        c.limitKw = lim ? round(lim.watts / 1000, 2) : null; c.limitBy = lim ? lim.by : null;
        // The car never asks for less than the minimum while it is not full: it tapers down to 6 A, not to 0
        var ph = phasesFor(c), minKw = ph ? MIN_AMPS * VOLTS * ph / 1000 : MIN_DC_KW, car = carAcceptsKw(c);
        c._carKw = car > 0 ? Math.max(car, minKw) : 0;
        c._allowKw = Math.min(powerKw, lim ? lim.watts / 1000 : Infinity);
        c._want = Math.min(c._allowKw, c._carKw);
      });
      // 2) The charge point's cap (hardware and ChargePointMaxProfile), shared equally and redistributed
      var cap = maxTotalKw(), cpl = chargePointLimit(t);
      if (cpl && cpl.watts / 1000 < cap) cap = cpl.watts / 1000;
      state.chargePointLimitKw = cpl ? round(cpl.watts / 1000, 2) : null; state.chargePointLimitBy = cpl ? cpl.by : null;
      // Each car needs at least its minimum (6 A per phase) or it doesn't charge at all. If the cap can't give that
      // to everyone, the ones that arrived first get it and the rest wait (SuspendedEVSE); never everyone below it.
      active.forEach(function (c) {
        var ph = phasesFor(c); c._min = ph ? MIN_AMPS * VOLTS * ph / 1000 : MIN_DC_KW; c._got = 0;
      });
      var left = cap, served = [];
      active.filter(function (c) { return c._want >= c._min - 1e-6; })
        .sort(function (a, b) { return (a.txStartedAt || 0) - (b.txStartedAt || 0) || a.id - b.id; })
        .forEach(function (c) { if (left >= c._min - 1e-6) { c._got = c._min; left -= c._min; served.push(c); } });
      // What is left, shared equally among the served ones up to what each one can take
      var open = served.slice();
      while (open.length && left > 1e-6) {
        var share = left / open.length, still = [];
        open.forEach(function (c) {
          var give = Math.min(share, c._want - c._got);
          c._got += give; left -= give;
          if (c._want - c._got > 1e-6) still.push(c);
        });
        if (still.length === open.length) break;
        open = still;
      }
      // 3) Below the minimum the car pauses: SuspendedEVSE (the charger limits) or SuspendedEV (the car is full)
      active.forEach(function (c) {
        var ph = phasesFor(c), kw = c._got;
        var minKw = ph ? MIN_AMPS * VOLTS * ph / 1000 : MIN_DC_KW;
        var full = c._carKw <= 0;
        if (kw < minKw - 1e-6) kw = 0;
        var real = kw ? kw * (0.97 + Math.random() * 0.03) : 0;   // a real charger rarely delivers its full allowance
        c.powerKw = round(real, 3);
        c.currentA = ph ? round(real * 1000 / VOLTS / ph, 1) : round(real * 1000 / DC_VOLTS, 1);
        // Energy from the power held since the last step (each connector counts from its own start)
        var dt = c._lastT ? (t - c._lastT) / 1000 : 0; c._lastT = t;
        if (dt > 0) {
          var wh = (c._lastKw || 0) * 1000 * dt / 3600;
          c.meterWh += wh; c.sessionWh += wh;
          if (c.car && c.car.batteryKwh) c.car.soc = Math.min(100, (c.car.soc || 0) + wh / 10 / c.car.batteryKwh * socSpeed);
        }
        c._lastKw = real;
        var want = real ? 'Charging' : (full ? 'SuspendedEV' : 'SuspendedEVSE');
        if (c.status !== want && ['_starting', 'Charging', 'SuspendedEV', 'SuspendedEVSE'].indexOf(c.status) >= 0) status(c, want);
      });
      changed();
    }
    function ensureTimers() {
      var any = conns.some(function (c) { return c.transactionId != null; });
      if (any && !tick) {
        tick = setInterval(physics, TICK_MS);
        meter = setInterval(function () { conns.forEach(function (c) { if (c.transactionId != null) sample(c); }); }, meterMs);
      } else if (!any && tick) { clearInterval(tick); clearInterval(meter); tick = meter = null; }
    }

    function sampledValues(c) {
      var ph = phasesFor(c), w = c.powerKw * 1000;
      var sv = [
        { value: String(Math.round(c.meterWh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh', context: 'Sample.Periodic' },
        { value: String(Math.round(w)), measurand: 'Power.Active.Import', unit: 'W', context: 'Sample.Periodic' }
      ];
      if (!ph) sv.push({ value: c.currentA.toFixed(1), measurand: 'Current.Import', unit: 'A', context: 'Sample.Periodic' });
      else ['L1', 'L2', 'L3'].slice(0, ph).forEach(function (p) {
        sv.push({ value: c.currentA.toFixed(1), measurand: 'Current.Import', unit: 'A', phase: p, context: 'Sample.Periodic' });
      });
      if (c.car && c.car.soc != null) sv.push({ value: String(Math.floor(c.car.soc)), measurand: 'SoC', unit: 'Percent', location: 'EV', context: 'Sample.Periodic' });
      return sv;
    }
    function sample(c) {
      return call('MeterValues', { connectorId: c.id, transactionId: c.transactionId,
                                   meterValue: [{ timestamp: now(), sampledValue: sampledValues(c) }] });
    }

    function startTransaction(c, idTag, txProfile) {
      if (!c || c.transactionId != null || !c.available) return;
      c.plugged = true; c.waitingTag = null;
      c.idTag = idTag || options.idTag || 'VIRTUAL-CARD';
      (c.status === 'Preparing' ? Promise.resolve() : status(c, 'Preparing')).then(function () {
        return call('StartTransaction', { connectorId: c.id, idTag: c.idTag, meterStart: Math.round(c.meterWh), timestamp: now() });
      }).then(function (r) {
        if (!r || r.transactionId == null || (r.idTagInfo && r.idTagInfo.status !== 'Accepted')) { status(c, idleStatus(c)); return; }
        c.transactionId = r.transactionId; c.sessionWh = 0; c.startedAt = c.txStartedAt = Date.now();
        // A TxProfile sent inside RemoteStartTransaction applies to this transaction
        if (txProfile) { txProfile.transactionId = r.transactionId; setChargingProfile(c.id, txProfile); }
        c._lastT = null; c._lastKw = 0;
        c.status = '_starting';   // physics() decides: Charging, or SuspendedEVSE/SuspendedEV if nothing can flow
        physics();
        ensureTimers();
        sample(c);
      });
    }
    function stopTransaction(c, reason, thenUnplug) {
      if (!c || c.transactionId == null) return;
      physics();   // energy up to this second
      var tx = c.transactionId; c.transactionId = null; c.powerKw = 0; c.currentA = 0; c.limitKw = null; c.limitBy = null;
      c._lastT = null; c._lastKw = 0;
      dropTxProfiles(c); ensureTimers();
      // StopTransaction first, Available last: some CSMSs close a session as abandoned if Available arrives first
      call('StopTransaction', { transactionId: tx, meterStop: Math.round(c.meterWh), timestamp: now(), reason: reason || 'Remote' })
        // After a power cut the StopTransaction can only go out once power is back: the cable is still in and a new
        // session can start, so Preparing (Finishing would leave the car waiting for good)
        .then(function () { return c.plugged ? status(c, reason === 'PowerLoss' && !state.powerOff ? 'Preparing' : 'Finishing') : null; })
        .then(function () {
          if (c.inoperativeAfterSession) { c.inoperativeAfterSession = false; c.available = false; if (!c.plugged) return status(c, 'Unavailable'); }
          if (thenUnplug) setTimeout(function () { unplug(c.id); }, 1500); else if (!c.plugged) status(c, idleStatus(c));
          setTimeout(physics, 50);
        });
    }
    function plugIn(cid, car) {
      var c = conn(cid); if (!c || c.plugged) return;
      c.plugged = true; if (car) c.car = JSON.parse(JSON.stringify(car)); changed();
      if (!c.available) return;
      if (c.waitingTag) { var prof = c._txProfile; c._txProfile = null; startTransaction(c, c.waitingTag, prof); }
      else if (c.transactionId == null) status(c, 'Preparing');
    }
    function unplug(cid) {
      var c = conn(cid); if (!c || !c.plugged) return;
      c.plugged = false; c.waitingTag = null; changed();
      if (c.transactionId != null) stopTransaction(c, 'EVDisconnected');
      else status(c, idleStatus(c));
      c.car = null;
    }
    function tapCard(idTag, cid) {
      idTag = idTag || options.idTag || 'VIRTUAL-CARD';
      var c = conn(cid); if (!c) return Promise.resolve('NoConnector');
      if (c.transactionId != null) {             // same card again: stop, the cable stays in (Finishing)
        if (idTag === c.idTag) stopTransaction(c, 'Local');
        return Promise.resolve('Stopping');
      }
      return call('Authorize', { idTag: idTag }).then(function (r) {
        var ok = r && r.idTagInfo && r.idTagInfo.status === 'Accepted';
        if (!ok) return r && r.idTagInfo ? r.idTagInfo.status : 'NoAnswer';
        if (c.plugged) startTransaction(c, idTag); else { c.waitingTag = idTag; changed(); }
        return 'Accepted';
      });
    }

    var KEYS = {   // configuration keys: [readonly, getter]
      HeartbeatInterval: [false, function () { return String(heartbeatMs / 1000); }],
      MeterValueSampleInterval: [false, function () { return String(meterMs / 1000); }],
      MeterValuesSampledData: [true, function () { return 'Energy.Active.Import.Register,Power.Active.Import,Current.Import,SoC'; }],
      NumberOfConnectors: [true, function () { return String(nConn); }],
      StopTransactionOnEVSideDisconnect: [true, function () { return 'true'; }],
      SupportedFeatureProfiles: [true, function () { return 'Core,SmartCharging,RemoteTrigger'; }],
      ChargeProfileMaxStackLevel: [true, function () { return '10'; }],
      ChargingScheduleAllowedChargingRateUnit: [true, function () { return 'Current,Power'; }],
      ChargingScheduleMaxPeriods: [true, function () { return '24'; }],
      MaxChargingProfilesInstalled: [true, function () { return '20'; }]
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
          if (meter) { clearInterval(meter); meter = setInterval(function () { conns.forEach(function (c) { if (c.transactionId != null) sample(c); }); }, meterMs); }
        }
        return 'Accepted';
      }
      return KEYS[key] ? 'Rejected' : 'NotSupported';
    }

    // Connector for a RemoteStartTransaction without connectorId: the plugged one waiting, else the first free one
    function freeConnector() {
      return conns.filter(function (c) { return c.available && c.transactionId == null && c.plugged; })[0] ||
             conns.filter(function (c) { return c.available && c.transactionId == null && !c.waitingTag; })[0] || null;
    }

    function answer(id, action, payload) {
      var r = { status: 'Accepted' }, c;
      if (action === 'RemoteStartTransaction') {
        c = payload.connectorId ? conn(payload.connectorId) : freeConnector();
        var prof = payload.chargingProfile;
        r.status = !c || c.transactionId != null || !c.available || (prof && prof.chargingProfilePurpose !== 'TxProfile') ? 'Rejected' : 'Accepted';
        if (r.status === 'Accepted') setTimeout(function () {
          if (c.plugged || !options.waitForPlug) startTransaction(c, payload.idTag, prof); else { c.waitingTag = payload.idTag; c._txProfile = prof; changed(); }
        }, 800);
      } else if (action === 'RemoteStopTransaction') {
        c = conns.filter(function (x) { return x.transactionId != null && x.transactionId == payload.transactionId; })[0];
        r.status = c ? 'Accepted' : 'Rejected';
        if (c) setTimeout(function () { stopTransaction(c, 'Remote'); }, 800);
      } else if (action === 'GetConfiguration') {
        var asked = payload.key && payload.key.length ? payload.key : Object.keys(KEYS);
        r = { configurationKey: [], unknownKey: [] };
        asked.forEach(function (k) {
          if (KEYS[k]) r.configurationKey.push({ key: k, readonly: KEYS[k][0], value: KEYS[k][1]() });
          else r.unknownKey.push(k);
        });
      } else if (action === 'ChangeConfiguration') {
        r.status = changeConfiguration(payload.key, payload.value);
      } else if (action === 'SetChargingProfile') {
        r.status = setChargingProfile(payload.connectorId, payload.csChargingProfiles);
      } else if (action === 'ClearChargingProfile') {
        r.status = clearChargingProfile(payload);
      } else if (action === 'GetCompositeSchedule') {
        if (payload.connectorId < 0 || payload.connectorId > nConn || !(payload.duration > 0)) r = { status: 'Rejected' };
        else r = compositeSchedule(payload.connectorId, payload.duration, payload.chargingRateUnit);
      } else if (action === 'TriggerMessage') {
        var what = payload.requestedMessage, tc = payload.connectorId;
        if (['Heartbeat', 'StatusNotification', 'MeterValues', 'BootNotification'].indexOf(what) < 0) r.status = 'NotImplemented';
        else if (tc != null && (tc < 0 || tc > nConn)) r.status = 'Rejected';
        else setTimeout(function () {
          var which = tc ? [conn(tc)] : conns;
          if (what === 'Heartbeat') call('Heartbeat', {});
          else if (what === 'StatusNotification') which.forEach(function (x) { status(x, x.status); });
          else if (what === 'MeterValues') which.forEach(function (x) {
            if (x.transactionId != null) sample(x);
            else call('MeterValues', { connectorId: x.id, meterValue: [{ timestamp: now(), sampledValue: [
              { value: String(Math.round(x.meterWh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh', context: 'Trigger' }] }] });
          });
          else boot();
        }, 500);
      } else if (action === 'ChangeAvailability') {
        var operative = payload.type === 'Operative', which = payload.connectorId ? [conn(payload.connectorId)] : conns;
        if (which.some(function (x) { return !x; })) r.status = 'Rejected';
        else {
          if (!operative && which.some(function (x) { return x.transactionId != null; })) r.status = 'Scheduled';
          setTimeout(function () {
            which.forEach(function (x) {
              if (!operative && x.transactionId != null) { x.inoperativeAfterSession = true; return; }
              x.available = operative; x.inoperativeAfterSession = false; status(x, idleStatus(x));
            });
          }, 300);
        }
      } else if (action === 'UnlockConnector') {
        c = conn(payload.connectorId);
        if (!c) r = { status: 'NotSupported' };
        else {
          r = { status: 'Unlocked' };
          setTimeout(function () { if (c.transactionId != null) stopTransaction(c, 'UnlockCommand'); unplugQuietly(c); }, 300);
        }
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

    function unplugQuietly(c) {   // the cable is released; the driver pulls it out
      if (!c.plugged) return;
      c.plugged = false; c.waitingTag = null; c.car = null; changed();
      if (c.transactionId == null) status(c, idleStatus(c));
    }

    function reboot(reason) {
      conns.forEach(function (c) { if (c.transactionId != null) stopTransaction(c, reason); });
      // Profiles survive a reboot (OCPP 1.6 §3.13.3: they are persistent), transactions do not
      setTimeout(function () {
        rebooting = true; state.rebooting = true; changed();
        if (ws) ws.close();
        setTimeout(function () { rebooting = false; state.rebooting = false; if (!closed) connect(); }, 5000);
      }, 800);
    }

    function boot() {
      // OCPP 1.6 BootNotification: vendor and model are CiString20, firmwareVersion CiString50. Longer is a
      // TypeConstraintViolation, so they are cut here rather than sent wrong.
      return call('BootNotification', { chargePointVendor: String(options.vendor || 'ocpp-virtual-charger').slice(0, 20),
        chargePointModel: String(options.model || 'Virtual charger').slice(0, 20),
        firmwareVersion: String(options.firmware || '1.0').slice(0, 50) })
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
            call('StatusNotification', { connectorId: 0, status: 'Available', errorCode: 'NoError', timestamp: now() });
            conns.forEach(function (c) {
              status(c, c.transactionId != null ? c.status : (c.plugged ? c.status : idleStatus(c)));
              // Back while charging: send a reading now so the CSMS knows the running transaction
              if (c.transactionId != null) sample(c);
            });
            ensureTimers();
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
        if (rebooting || closed) { clearInterval(tick); clearInterval(meter); tick = meter = null; return; }
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
      start: function (idTag, connectorId) { startTransaction(conn(connectorId), idTag); },
      /** Local stop; the cable is pulled out right after. */
      stop: function (connectorId) { stopTransaction(conn(connectorId), 'Local', true); },
      /** Plug a car in (optional car model): Preparing, or starts at once if a card was authorized before. */
      plugIn: function (connectorId, car) { plugIn(connectorId, car); },
      /** Pull the cable out: ends the running session (EVDisconnected) and goes back to Available. */
      unplug: function (connectorId) { unplug(connectorId); },
      /** Tap a card on the reader: Authorize, then start (cable in) or wait for the cable; the same card stops. */
      tapCard: function (idTag, connectorId) { return tapCard(idTag, connectorId); },
      /** Simulate a network outage of `seconds`: keeps charging, queues messages, delivers them on reconnect. */
      outage: function (seconds) {
        if (!ws || ws.readyState !== 1 || outage) return;
        outage = true; state.offline = true; state.delivered = null; queue = []; state.queued = 0; changed();
        ws.close();
        setTimeout(function () { outage = false; if (!closed) connect(); }, (seconds || 20) * 1000);
      },
      /** Power cut of `seconds` (a tripped breaker): the charger switches off, its sessions end with reason PowerLoss,
       *  and when power is back it boots again and delivers what it kept. The cars stay plugged in. */
      powerLoss: function (seconds) {
        if (closed || state.powerOff) return;
        outage = true; state.offline = true; state.powerOff = true; state.delivered = null; changed();
        conns.forEach(function (c) { if (c.transactionId != null) stopTransaction(c, 'PowerLoss'); c.waitingTag = null; });
        clearInterval(heartbeat);
        if (ws) ws.close();
        setTimeout(function () {
          outage = false; state.powerOff = false;
          // Power back with the car still plugged in: a new session can start (Preparing), the old one ended
          conns.forEach(function (c) { if (c.transactionId == null && c.plugged && c.status === 'Finishing') c.status = 'Preparing'; });
          changed(); if (!closed) connect();
        }, (seconds || 30) * 1000);
      },
      /** Change each connector's rated power (kW). Up to 7.4 one-phase AC, up to 22 three-phase AC, above that DC. */
      setPower: function (kw) { powerKw = kw; physics(); },
      /** Change what the whole charge point can deliver at once (kW); null = rating × connectors. */
      setChargerMax: function (kw) { chargerMaxKw = kw || null; physics(); },
      /** How much faster the cars' batteries fill than real time. */
      setSocSpeed: function (x) { socSpeed = x > 0 ? x : 1; },
      /** Composite schedule for a connector, as GetCompositeSchedule would answer it (for display). */
      composite: function (connectorId, duration, unit) { return compositeSchedule(connectorId || 0, duration || 3600, unit || 'W'); },
      /** Try again after giving up (state.gaveUp). */
      retry: function () { if (!closed && state.gaveUp) { failures = 0; state.gaveUp = false; changed(); connect(); } },
      /** Disconnect for good. */
      close: function () { closed = true; clearInterval(heartbeat); clearInterval(meter); clearInterval(tick); tick = meter = null; if (ws) ws.close(); }
    };
  };
});
