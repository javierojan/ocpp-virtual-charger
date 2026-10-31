// A whole charging site from the command line (Node.js 22+), with Basic Auth if your CSMS asks for it — the thing a
// browser can't do. It connects every post, plugs the cars of the scenario in, taps their cards and prints a table
// every few seconds: status, power, current, the limit each connector obeys and who set it.
//
//   node examples/site.js examples/site.example.json
//
// The scenario file (see site.example.json): the CSMS address without the identity, the posts with their key,
// connectors and power, and the cars that arrive. Keep files with real keys out of version control.
'use strict';
const fs = require('fs');
const OcppVirtualCharger = require('../ocpp-virtual-charger.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node examples/site.js <scenario.json>'); process.exit(1); }
const sc = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!/^wss?:\/\/.+\/$/.test(sc.url || '')) { console.error('"url" must be the OCPP address without the identity, ending in /'); process.exit(1); }

const CARS = {
  small: { batteryKwh: 40, maxAcKw: 7.4, maxDcKw: 50, phases: 1 },
  saloon: { batteryKwh: 64, maxAcKw: 11, maxDcKw: 100, phases: 3 },
  suv: { batteryKwh: 77, maxAcKw: 11, maxDcKw: 150, phases: 3 },
  van: { batteryKwh: 75, maxAcKw: 22, maxDcKw: 80, phases: 3 },
  phev: { batteryKwh: 13, maxAcKw: 3.7, maxDcKw: 0, phases: 1 }
};

const posts = sc.posts.map((p) => ({
  id: p.id,
  charger: OcppVirtualCharger(sc.url + encodeURIComponent(p.id), {
    connectors: p.connectors || 1, powerKw: p.powerKw || 7.4, chargerMaxKw: p.chargerMaxKw, socSpeed: sc.socSpeed || 1,
    authorizationKey: p.key || undefined, vendor: 'ocpp-virtual-charger', model: 'Virtual site post', waitForPlug: true,
    onFrame: sc.verbose ? (dir, f) => console.log(p.id, dir === 'out' ? '→' : '←', JSON.stringify(f)) : undefined
  })
}));

// Cars of the scenario: { post: 1, connector: 1, car: 'saloon', soc: 30, targetSoc: 100, card: 'CARD-1', at: 5 }
(sc.cars || []).forEach((c) => {
  setTimeout(() => {
    const p = posts[(c.post || 1) - 1]; if (!p) return;
    const car = Object.assign({}, CARS[c.car] || CARS.saloon, { soc: c.soc != null ? c.soc : 30, targetSoc: c.targetSoc || 100 });
    p.charger.plugIn(c.connector || 1, car);
    setTimeout(() => p.charger.tapCard(c.card || p.id + '-C' + (c.connector || 1), c.connector || 1)
      .then((r) => { if (r !== 'Accepted') console.log(`${p.id}/${c.connector || 1}: card ${r}`); }), 2000);
  }, (c.at || 3) * 1000);
});

const pad = (s, n) => String(s).padEnd(n);
setInterval(() => {
  let total = 0;
  const rows = [];
  posts.forEach((p) => {
    const s = p.charger.state; total += s.totalKw || 0;
    const net = s.powerOff ? 'no power' : s.offline ? 'offline' : s.gaveUp ? 'REJECTED' : s.connected ? 'online' : 'connecting';
    s.connectors.forEach((c) => rows.push(pad(p.id, 12) + pad(c.id, 3) + pad(net, 11) + pad(c.status, 14) +
      pad(c.powerKw.toFixed(1) + ' kW', 10) + pad(c.currentA.toFixed(1) + ' A', 9) +
      pad(c.car ? Math.floor(c.car.soc) + ' %' : '', 7) + (c.limitBy ? c.limitKw + ' kW (' + c.limitBy + ')' : '') +
      (c.id === 1 && s.chargePointLimitBy ? '  post ' + s.chargePointLimitKw + ' kW (' + s.chargePointLimitBy + ')' : '')));
  });
  const grid = sc.gridKw ? ` of ${sc.gridKw} kW` + ((total + (sc.buildingKw || 0)) > sc.gridKw ? '  ← ABOVE THE GRID CONNECTION' : '') : '';
  console.log(`\n${new Date().toLocaleTimeString()}  chargers ${total.toFixed(1)} kW + building ${(sc.buildingKw || 0)} kW${grid}`);
  console.log(pad('post', 12) + pad('#', 3) + pad('network', 11) + pad('status', 14) + pad('power', 10) + pad('current', 9) + pad('car', 7) + 'limit');
  rows.forEach((r) => console.log(r));
}, (sc.printEverySec || 5) * 1000);

function end() { posts.forEach((p) => p.charger.close()); setTimeout(() => process.exit(0), 300); }
process.on('SIGINT', end);
if (sc.runForSec) setTimeout(end, sc.runForSec * 1000);   // for unattended runs
