// Tests for the charger model: connectors, Smart Charging profiles, cars, outages. No network: an in-memory CSMS
// answers through `createSocket`. Run with: node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const OcppVirtualCharger = require('../ocpp-virtual-charger.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A minimal CSMS: accepts everything, numbers transactions, records what the charger says, and can send commands.
function fakeCsms() {
  const csms = { frames: [], tx: 0, sockets: 0, socket: null, pending: {} };
  csms.createSocket = function () {
    const sock = { readyState: 0, onopen: null, onmessage: null, onclose: null };
    csms.socket = sock; csms.sockets++;
    sock.send = function (raw) {
      const m = JSON.parse(raw);
      csms.frames.push(m);
      if (m[0] === 2) {
        const [, id, action, p] = m;
        let r = {};
        if (action === 'BootNotification') r = { status: 'Accepted', currentTime: new Date().toISOString(), interval: 60 };
        else if (action === 'Heartbeat') r = { currentTime: new Date().toISOString() };
        else if (action === 'Authorize' || action === 'StopTransaction') r = { idTagInfo: { status: 'Accepted' } };
        else if (action === 'StartTransaction') r = { idTagInfo: { status: 'Accepted' }, transactionId: ++csms.tx };
        setTimeout(() => sock.onmessage && sock.onmessage({ data: JSON.stringify([3, id, r]) }), 1);
      } else if (m[0] === 3 && csms.pending[m[1]]) { csms.pending[m[1]](m[2]); delete csms.pending[m[1]]; }
    };
    sock.close = function () { if (sock.readyState === 3) return; sock.readyState = 3; setTimeout(() => sock.onclose && sock.onclose(), 1); };
    setTimeout(() => { sock.readyState = 1; sock.onopen && sock.onopen(); }, 1);
    return sock;
  };
  csms.cmd = function (action, payload) {
    const id = 'c' + Math.random().toString(16).slice(2);
    return new Promise((resolve) => {
      csms.pending[id] = resolve;
      csms.socket.onmessage({ data: JSON.stringify([2, id, action, payload]) });
    });
  };
  csms.sent = (action) => csms.frames.filter((f) => f[0] === 2 && f[2] === action).map((f) => f[3]);
  csms.lastStatus = (cid) => { const s = csms.sent('StatusNotification').filter((p) => p.connectorId === cid); return s.length ? s[s.length - 1].status : null; };
  return csms;
}

function profile(id, purpose, limit, extra) {
  return Object.assign({ chargingProfileId: id, stackLevel: 0, chargingProfilePurpose: purpose, chargingProfileKind: 'Absolute',
    chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit: limit }] } }, extra || {});
}

async function charging(opts, cars) {
  const csms = fakeCsms();
  const ch = OcppVirtualCharger('ws://x/ocpp/T-1', Object.assign({ createSocket: csms.createSocket, meterIntervalSec: 1 }, opts));
  await wait(50);
  for (let i = 0; i < cars.length; i++) { ch.plugIn(i + 1, cars[i]); await ch.tapCard('CARD-' + (i + 1), i + 1); await wait(30); }
  await wait(1200);
  return { csms, ch };
}

const car3 = { batteryKwh: 60, soc: 20, maxAcKw: 22, phases: 3 };
const car1 = { batteryKwh: 40, soc: 20, maxAcKw: 7.4, phases: 1 };

test('two connectors share the charge point cap (ChargePointMaxProfile)', async () => {
  const { csms, ch } = await charging({ connectors: 2, powerKw: 22 }, [car3, car3]);
  assert.strictEqual((await csms.cmd('SetChargingProfile', { connectorId: 0, csChargingProfiles: profile(1, 'ChargePointMaxProfile', 16) })).status, 'Accepted');
  await wait(1200);
  const [a, b] = ch.state.connectors;
  assert.ok(a.powerKw + b.powerKw <= 16 * 230 * 3 / 1000 + 0.01, 'total within 16 A × 3 phases');
  assert.ok(a.powerKw > 4 && b.powerKw > 4, 'both charge');
  ch.close();
});

test('a cap too small for two cars: the first one charges, the second waits (never both below 6 A)', async () => {
  const { csms, ch } = await charging({ connectors: 2, powerKw: 7.4 }, [car1, car1]);
  await csms.cmd('SetChargingProfile', { connectorId: 0, csChargingProfiles: profile(1, 'ChargePointMaxProfile', 10, {
    chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit: 10, numberPhases: 1 }] } }) });
  await wait(1300);
  const [a, b] = ch.state.connectors;
  assert.ok(a.currentA >= 6 && a.status === 'Charging', 'first car at 6 A or more');
  assert.strictEqual(b.powerKw, 0); assert.strictEqual(b.status, 'SuspendedEVSE');
  assert.strictEqual(csms.lastStatus(2), 'SuspendedEVSE');
  ch.close();
});

test('TxProfile of 0 A pauses the connector; clearing it resumes', async () => {
  const { csms, ch } = await charging({ connectors: 1, powerKw: 11 }, [car3]);
  const tx = ch.state.connectors[0].transactionId;
  const r = await csms.cmd('SetChargingProfile', { connectorId: 1, csChargingProfiles: profile(5, 'TxProfile', 0, { transactionId: tx }) });
  assert.strictEqual(r.status, 'Accepted');
  await wait(1200);
  assert.strictEqual(ch.state.connectors[0].status, 'SuspendedEVSE');
  assert.strictEqual((await csms.cmd('ClearChargingProfile', { id: 5 })).status, 'Accepted');
  await wait(1200);
  assert.strictEqual(ch.state.connectors[0].status, 'Charging');
  assert.ok(ch.state.connectors[0].powerKw > 10);
  ch.close();
});

test('profiles that OCPP 1.6 does not allow are rejected', async () => {
  const { csms, ch } = await charging({ connectors: 2, powerKw: 11 }, []);
  assert.strictEqual((await csms.cmd('SetChargingProfile', { connectorId: 1, csChargingProfiles: profile(1, 'TxProfile', 10) })).status, 'Rejected', 'TxProfile without a transaction');
  assert.strictEqual((await csms.cmd('SetChargingProfile', { connectorId: 1, csChargingProfiles: profile(2, 'ChargePointMaxProfile', 10) })).status, 'Rejected', 'ChargePointMax on a connector');
  assert.strictEqual((await csms.cmd('SetChargingProfile', { connectorId: 3, csChargingProfiles: profile(3, 'TxDefaultProfile', 10) })).status, 'Rejected', 'connector that does not exist');
  assert.strictEqual((await csms.cmd('ClearChargingProfile', { id: 99 })).status, 'Unknown');
  ch.close();
});

test('TxDefaultProfile on a connector wins over connector 0; the highest stackLevel wins', async () => {
  const { csms, ch } = await charging({ connectors: 2, powerKw: 22 }, [car3, car3]);
  await csms.cmd('SetChargingProfile', { connectorId: 0, csChargingProfiles: profile(1, 'TxDefaultProfile', 16) });
  await csms.cmd('SetChargingProfile', { connectorId: 2, csChargingProfiles: profile(2, 'TxDefaultProfile', 8) });
  await csms.cmd('SetChargingProfile', { connectorId: 0, csChargingProfiles: profile(3, 'TxDefaultProfile', 10, { stackLevel: 2 }) });
  await wait(1200);
  const [a, b] = ch.state.connectors;
  assert.strictEqual(a.limitBy, 'TxDefaultProfile #3'); assert.ok(Math.abs(a.limitKw - 6.9) < 0.01);
  assert.strictEqual(b.limitBy, 'TxDefaultProfile #2'); assert.ok(Math.abs(b.limitKw - 5.52) < 0.01);
  ch.close();
});

test('GetCompositeSchedule follows the periods of the profile', async () => {
  const { csms, ch } = await charging({ connectors: 1, powerKw: 22 }, []);
  await csms.cmd('SetChargingProfile', { connectorId: 0, csChargingProfiles: profile(1, 'TxDefaultProfile', 0, {
    chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }, { startPeriod: 600, limit: 8 }] } }) });
  const r = await csms.cmd('GetCompositeSchedule', { connectorId: 1, duration: 1200, chargingRateUnit: 'A' });
  assert.strictEqual(r.status, 'Accepted');
  const p = r.chargingSchedule.chargingSchedulePeriod;
  assert.strictEqual(p[0].limit, 16); assert.ok(p.some((x) => x.limit === 8 && Math.abs(x.startPeriod - 600) <= 1));
  ch.close();
});

test('a full car stops by itself: SuspendedEV', async () => {
  const { ch } = await charging({ connectors: 1, powerKw: 11, socSpeed: 2000 }, [{ batteryKwh: 10, soc: 98, maxAcKw: 11, phases: 3 }]);
  await wait(2500);
  assert.strictEqual(ch.state.connectors[0].status, 'SuspendedEV');
  ch.close();
});

test('a car never asks for less than 6 A while it is not full', async () => {
  const { ch } = await charging({ connectors: 1, powerKw: 11 }, [{ batteryKwh: 60, soc: 99, maxAcKw: 11, phases: 3 }]);
  const c = ch.state.connectors[0];
  assert.strictEqual(c.status, 'Charging'); assert.ok(c.currentA >= 5.8, 'about 6 A at the end of the charge');
  ch.close();
});

test('power cut: sessions end with PowerLoss, delivered when the charger boots again', async () => {
  const { csms, ch } = await charging({ connectors: 2, powerKw: 11 }, [car3]);
  ch.powerLoss(0.3);
  await wait(800);
  const stops = csms.sent('StopTransaction');
  assert.strictEqual(stops.length, 1); assert.strictEqual(stops[0].reason, 'PowerLoss');
  assert.strictEqual(csms.sent('BootNotification').length, 2);
  assert.strictEqual(ch.state.connectors[0].status, 'Preparing', 'car still plugged in');
  ch.close();
});

test('meter values carry energy, power, current per phase and the car state of charge', async () => {
  const { csms, ch } = await charging({ connectors: 1, powerKw: 22 }, [car3]);
  const mv = csms.sent('MeterValues').filter((m) => m.transactionId != null).pop();
  const by = (m, ph) => mv.meterValue[0].sampledValue.filter((s) => s.measurand === m && (ph ? s.phase === ph : true));
  assert.ok(by('Energy.Active.Import.Register').length === 1);
  assert.strictEqual(by('Current.Import').length, 3);
  assert.strictEqual(by('SoC')[0].location, 'EV');
  ch.close();
});
