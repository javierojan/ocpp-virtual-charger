// Tests for the plan view's calculations: the outline from its measurements, the voltage drop of a cable and the
// local balancer keeping every cable under its breaker. Run with: node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { calc } = require('../plano.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} ≉ ${b}`);

test('outline: the sample garage closes, and a wrong measurement shows the gap instead of closing it', () => {
  const o = calc.defaultPlan().outline;
  assert.deepStrictEqual(calc.outlinePoints(o).slice(0, 6), [[0, 0], [40, 0], [40, 26], [16, 26], [16, 20], [0, 20]]);
  assert.strictEqual(calc.closureGap(o).d, 0);
  o.tramos[0].l = 41;                                       // one stretch a metre too long
  const g = calc.closureGap(o);
  assert.strictEqual(g.d, 1); assert.strictEqual(g.dx, -1); assert.strictEqual(g.dy, 0);
});

test('outline: clicked corners become stretches with their turns', () => {
  const o = { x0: 0, y0: 0, h0: 0, tramos: [] };
  calc.outlineAdd(o, [10, 0]); calc.outlineAdd(o, [10, 5]); calc.outlineAdd(o, [0, 5]); calc.outlineAdd(o, [0, 0]);
  assert.deepStrictEqual(o.tramos.map((s) => s.l), [10, 5, 10, 5]);
  assert.deepStrictEqual(o.tramos.slice(0, 3).map((s) => s.t), [90, 90, 90]);   // y grows downwards: clockwise = right
  o.closed = true;
  assert.strictEqual(calc.closureGap(o).d, 0);
});

test('voltage drop: one charger at the end, three-phase (√3·L·I / γ·S over 400 V)', () => {
  const line = { amps: 32, mm2: 4, pts: [[0, 4.1], [55.25, 4.1]], chargers: [0] };
  const r = calc.lineDrop(line, [0, 0], { 0: [55.25, 4.1] }, { 0: 32 }, 3);
  near(r.v, Math.sqrt(3) * 59.35 * 32 / (48 * 4), 0.01, 'volts');
  near(r.pct, r.v / 400 * 100, 1e-9, 'percent');
  near(r.length, 59.35, 0.01, 'length');
});

test('voltage drop: chargers along the cable share only the part they have in common', () => {
  // Two chargers of 16 A, at 10 m and 30 m: the first 10 m carry 32 A, the last 20 m carry 16 A
  const line = { amps: 40, mm2: 6, pts: [[30, 0]], chargers: [0, 1] };
  const r = calc.lineDrop(line, [0, 0], { 0: [10, 0], 1: [30, 0] }, { 0: 16, 1: 16 }, 3);
  near(r.v, Math.sqrt(3) * (10 * 32 + 20 * 16) / (48 * 6), 0.01, 'far charger');
  assert.strictEqual(r.worst, 1);
  assert.strictEqual(r.amps, 32);
});

test('voltage drop: single-phase supply uses 2·L·I over 230 V, and the drop cable counts', () => {
  const line = { amps: 32, mm2: 6, pts: [[20, 0]], chargers: [0] };
  const r = calc.lineDrop(line, [0, 0], { 0: [20, 3] }, { 0: 32 }, 1);     // tapped at 20 m, 3 m down to the charger
  near(r.v, 2 * 23 * 32 / (48 * 6), 0.01, 'volts');
  near(r.pct, r.v / 230 * 100, 1e-9);
});

test('amps per kW: three-phase charger, single-phase car, DC and a single-phase supply', () => {
  near(calc.ampsPerKw(11, 3, 3) * 11, 15.88, 0.01);
  near(calc.ampsPerKw(11, 1, 3) * 7.4, 32.17, 0.01);       // a one-phase car on an 11 kW charger: all on one phase
  near(calc.ampsPerKw(50, 1, 3) * 50, 72.17, 0.01);        // DC takes three-phase AC whatever the car
  near(calc.ampsPerKw(11, 3, 1) * 7.4, 32.17, 0.01);
});

test('local balancer: a cable never goes over its breaker, and what it leaves goes to the others', () => {
  const apk = calc.ampsPerKw(22, 3, 3);
  const hose = (since, line) => ({ since, min: 4.14, want: 22, apk, line });
  const hoses = [hose(1, 'L1'), hose(2, 'L1'), hose(3, 'L2')];
  calc.allocate(hoses, 60, { L1: 32, L2: 63 });
  const l1 = (hoses[0].got + hoses[1].got) * apk;
  assert.ok(l1 <= 32 + 1e-6, 'L1 at ' + l1 + ' A');
  near(l1, 32, 0.05, 'L1 used to the full');
  near(hoses[2].got, 22, 0.01, 'L2 gets what it wants');
  near(hoses[0].got, hoses[1].got, 0.01, 'equal shares on L1');
});

test('local balancer: a hose that does not fit on its cable waits, without taking the site', () => {
  const apk = calc.ampsPerKw(11, 3, 3);
  const hoses = [1, 2, 3].map((i) => ({ since: i, min: 4.14, want: 11, apk, line: 'L1' }));
  calc.allocate(hoses, 100, { L1: 16 });                    // room for two minimums (2 × 6 A), not three
  assert.deepStrictEqual(hoses.map((h) => h.got > 0), [true, true, false]);
  assert.ok((hoses[0].got + hoses[1].got) * apk <= 16 + 1e-6);
});

test('local balancer: without cables it shares the site as before', () => {
  const hoses = [1, 2].map((i) => ({ since: i, min: 4.14, want: 22, apk: 1, line: null }));
  calc.allocate(hoses, 30, {});
  near(hoses[0].got, 15, 0.01); near(hoses[1].got, 15, 0.01);
});

test('phaseSplit: three-phase hoses load R, S and T alike; single-phase ones only their phase', () => {
  const { phaseSplit } = require('../plano.js').calc;
  const tri = phaseSplit(11, 11, 3, 3, 2);
  assert.ok(Math.abs(tri[0] - 15.88) < 0.05 && tri[0] === tri[1] && tri[1] === tri[2]);
  const mono = phaseSplit(7.4, 7.4, 1, 3, 2);
  assert.deepStrictEqual(mono.map(x => Math.round(x * 10) / 10), [0, 32.2, 0]);
  const carMono = phaseSplit(3.7, 11, 1, 3, 3);   // a single-phase car on a three-phase charger: only phase 3
  assert.ok(carMono[0] === 0 && carMono[1] === 0 && carMono[2] > 16);
  const supplyMono = phaseSplit(7.4, 7.4, 1, 1, 3); // single-phase supply: everything on the one phase
  assert.ok(supplyMono[0] > 32 && supplyMono[1] === 0);
  assert.deepStrictEqual(phaseSplit(0, 11, 3, 3, 1), [0, 0, 0]);
});
