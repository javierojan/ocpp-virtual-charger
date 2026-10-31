# ocpp-virtual-charger

An **OCPP 1.6J charge point that runs in your browser or in Node.js**, with no install and no dependencies.
Point it at any central system (CSMS), start and stop sessions, and watch every frame go by.

**▶ Live demo: https://askacharge.com/askacharge/virtual-charger/**

It behaves like a real charger on the wire:

- `BootNotification`, heartbeats at the interval the CSMS asks for, `StatusNotification` for every change.
- Full sessions: `Preparing` → `StartTransaction` → `Charging` with `MeterValues` (energy register, power, current)
  → `StopTransaction` → `Finishing` → `Available`. `StopTransaction` always goes before `Available`: some CSMSs
  close a session as abandoned when `Available` arrives first.
- Answers `RemoteStartTransaction`, `RemoteStopTransaction`, `GetConfiguration`, `TriggerMessage`
  (Heartbeat, StatusNotification, MeterValues, BootNotification) and `UnlockConnector`.
- **Network outage simulation**: it keeps charging while offline, queues its `MeterValues`, `StatusNotification`
  and `StopTransaction`, and delivers them in order, with their original timestamps, when it reconnects.
  Useful to check how your CSMS handles late meter values.
- Reconnects on its own when the connection drops, like real hardware, and stops after 5 refused handshakes in a row
  instead of hammering the CSMS.
- Commands that act, not just answer: `Reset` reboots it, `ChangeAvailability` takes it out of service (`Scheduled`
  while charging), `UnlockConnector` releases the cable, interval changes apply.
- **Credential provisioning**: in Node it accepts `ChangeConfiguration AuthorizationKey` (and `SecurityProfile` up to 2)
  and reconnects with Basic Auth, the way a CSMS hands a key to a new charger. In a browser it answers `NotSupported`.
- Power selector on the demo page: 3.7, 7.4, 11, 22 kW AC and 50, 150 kW DC.

## Use it in the browser

Open `index.html` (or the live demo), paste an OCPP URL that ends in the charger identity, and press **Connect**.

No CSMS at hand? The [askacharge.com OCPP test server](https://askacharge.com/askacharge/en/ocpp-test-server.html)
gives you a free URL with no account, validates every frame against the official OCA JSON schemas and shows you
what it sees.

Or embed it in your own page:

```html
<script src="ocpp-virtual-charger.js"></script>
<script>
  const charger = OcppVirtualCharger('wss://your-csms.example/ocpp/CP-001', {
    onChange: state => console.log(state.status, state.meterWh),
    onFrame: (direction, frame) => console.log(direction, frame),
  });
  charger.start();      // local start, as if a card had been tapped
  charger.stop();       // local stop
  charger.outage(20);   // 20 seconds without network
  charger.close();
</script>
```

## Use it from Node.js

Node.js 22+ has a global `WebSocket`, so it runs as is:

```bash
node examples/node.js wss://your-csms.example/ocpp/CP-001
```

Node can also send **Basic Auth** (OCPP security profile 1 and 2), which browsers can't:

```js
const OcppVirtualCharger = require('./ocpp-virtual-charger.js');
const auth = 'Basic ' + Buffer.from('CP-001:your-authorization-key').toString('base64');
const charger = OcppVirtualCharger('wss://your-csms.example/ocpp/CP-001', {
  createSocket: (url, protocols) => new WebSocket(url, { protocols, headers: { Authorization: auth } }),
});
```

## Options

| Option | Default | |
|---|---|---|
| `onChange(state)` | — | Called on every state change |
| `onFrame(direction, frame)` | — | `'out'` or `'in'`, with the raw OCPP-J frame |
| `vendor`, `model`, `firmware` | `ocpp-virtual-charger`, `Virtual charger`, `1.0` | Sent in `BootNotification`, cut to the OCPP 1.6 limits (20, 20 and 50 characters) |
| `powerKw` | `7.4` | Rated power. Up to 7.4 kW: one-phase AC; up to 22 kW: three-phase AC (current on L1, L2, L3); above: DC. `setPower(kw)` changes it, mid-session too |
| `meterIntervalSec` | `5` | `MeterValues` interval while charging |
| `heartbeatSec` | `60` | Until the CSMS sets its own interval |
| `idTag` | `VIRTUAL-CARD` | Card used by `start()` |
| `createSocket(url, protocols)` | global `WebSocket` | Return any WebSocket-like object (headers, proxies…) |

## What it is not

Said plainly, so you don't find out the hard way:

- **OCPP 1.6J only**, one connector. No OCPP 2.0.1 yet.
- In the browser it **cannot send Basic Auth**: WebSocket APIs in browsers don't allow custom headers. Use a CSMS
  that accepts the charger without a password, or run it from Node.
- `ChangeConfiguration`, `ChangeAvailability`, `Reset` and `ClearCache` are acknowledged but not acted upon.
  Firmware, diagnostics, reservations, smart charging and local lists answer `NotImplemented`.
- It is a simulator for development, demos and testing, **not a conformance tester**. For certification-grade
  testing, the Open Charge Alliance has the OCTT.

## En español

Un cargador OCPP 1.6J que funciona en el navegador o en Node.js, sin instalar nada. Lo apuntas a cualquier
plataforma de gestión (CSMS), arrancas y paras cargas, simulas cortes de red y ves cada mensaje.
Demo: https://askacharge.com/askacharge/virtual-charger/ · Si no tienes un CSMS a mano, el
[servidor de pruebas de askacharge.com](https://askacharge.com/askacharge/probar-ocpp.html) te da una dirección gratis y sin cuenta.

## License

MIT © 2026 Javier Ojanguren ([askacharge.com](https://askacharge.com/askacharge/?src=github-ovc)).
Born inside askacharge.com, an open-standards EV charging platform, where it powers the
[dashboard tester](https://askacharge.com/askacharge/en/ocpp-test-panel.html?virtual=1).
