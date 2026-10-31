# ocpp-virtual-charger

An **OCPP 1.6J charge point that runs in your browser or in Node.js**, with no install and no dependencies.
Point it at any central system (CSMS), start and stop sessions, and watch every frame go by.
Or put **a whole charging site** behind one grid connection and see whether your CSMS shares the power well.

**▶ One charger: https://askacharge.com/askacharge/virtual-charger/**
**▶ A charging site: https://askacharge.com/askacharge/virtual-charger/site.html**

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
- **Several connectors** per charge point (1 to 8), each with its own session, meter and status.
- **Smart Charging that really limits the power**: `SetChargingProfile`, `ClearChargingProfile` and
  `GetCompositeSchedule`, with `ChargePointMaxProfile`, `TxDefaultProfile` (connector 0 or one connector) and
  `TxProfile` (also inside `RemoteStartTransaction`), stack levels, Absolute/Relative/Recurring schedules, amps or
  watts. The next meter value shows the new power.
- **Cars**: battery size, state of charge, what they accept in AC/DC and on how many phases. A car never draws less
  than 6 A per phase while it isn't full; when the limit leaves less than that, it waits (`SuspendedEVSE`); when it is
  full, it stops by itself (`SuspendedEV`). If a cap can't give 6 A to everyone, the first to arrive charges and the
  others wait, never all of them below the minimum. `MeterValues` carry `SoC`.
- **Power cut** (not just a network cut): sessions end with reason `PowerLoss`, delivered when the charger boots again.

## A charging site

`site.html` is a car park seen from above, with a small building next to it and one grid connection (LGA) for both,
for testing load balancing. Click a charger to give it a name (added to a generic OCPP address) and a power; cars drive
in, plug in, tap their card, charge and leave when full or after a while. Settings on the page: LGA power (3×25 A to
3×250 A), building load with random peaks, the main breaker tripping if the site goes over the LGA for 10, 30 or 60 s,
how many chargers (1 to 6, one or two hoses), how fast the batteries fill and how often cars arrive. It shows the load
against the LGA, a 10-minute chart, and each bay with its status, power, state of charge and the profile limiting it.

From Node, with Basic Auth per charger (what a browser can't send), the same site runs from a scenario file and prints
a table every few seconds:

```bash
node examples/site.js examples/site.example.json
```

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

- **OCPP 1.6J only**. No OCPP 2.0.1 yet.
- In the browser it **cannot send Basic Auth**: WebSocket APIs in browsers don't allow custom headers. Use a CSMS
  that accepts the charger without a password, or run it from Node.
- `ChangeConfiguration` applies `HeartbeatInterval`, `MeterValueSampleInterval` and, in Node, `AuthorizationKey`
  and `SecurityProfile` (1-2). Any other key it knows is read-only (`Rejected`); the rest, `NotSupported`.
  `ClearCache` is accepted: there is no cache to clear.
- Firmware, diagnostics, reservations and local lists answer `NotImplemented`.
- The physics are simplified on purpose: flat charging curves with a taper near the end, 230 V per phase, DC current
  at a 400 V battery, building load as a random walk. Good for seeing what a CSMS does, not for sizing an installation.
- The site page doesn't measure the grid for your CSMS: it shows what the chargers draw. A CSMS that reads a real
  meter needs its own channel for that (MQTT, Modbus, an API), which is outside OCPP 1.6.
- It is a simulator for development, demos and testing, **not a conformance tester**. For certification-grade
  testing, the Open Charge Alliance has the OCTT.

## En español

Un cargador OCPP 1.6J que funciona en el navegador o en Node.js, sin instalar nada. Lo apuntas a cualquier
plataforma de gestión (CSMS), arrancas y paras cargas, simulas cortes de red y ves cada mensaje.
Demo: https://askacharge.com/askacharge/virtual-charger/ · Instalación con varios cargadores, acometida y
reparto de carga: https://askacharge.com/askacharge/virtual-charger/site.html · Si no tienes un CSMS a mano, el
[servidor de pruebas de askacharge.com](https://askacharge.com/askacharge/probar-ocpp.html) te da una dirección gratis y sin cuenta.

## Tests

```bash
npm test   # node --test, no network: an in-memory CSMS checks profiles, sharing, cars and power cuts
```

## License

MIT © 2026 Javier Ojanguren ([askacharge.com](https://askacharge.com/askacharge/?src=github-ovc)).
Born inside askacharge.com, an open-standards EV charging platform, where it powers the
[dashboard tester](https://askacharge.com/askacharge/en/ocpp-test-panel.html?virtual=1).
