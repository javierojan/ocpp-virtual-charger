// Run a virtual charger from the command line (Node.js 22+, which has a global WebSocket):
//   node examples/node.js wss://your-csms.example/ocpp/CP-001
// It connects, charges for 30 seconds and stops. Every OCPP frame is printed.
const OcppVirtualCharger = require('../ocpp-virtual-charger.js');

const url = process.argv[2];
if (!url) { console.error('Usage: node examples/node.js <ocpp-url-with-identity>'); process.exit(1); }

const charger = OcppVirtualCharger(url, {
  onFrame: (dir, frame) => console.log(dir === 'out' ? '→' : '←', JSON.stringify(frame)),
});
setTimeout(() => charger.start(), 4000);
setTimeout(() => charger.stop(), 34000);
setTimeout(() => { charger.close(); process.exit(0); }, 40000);
