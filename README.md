# CloudTAK Plugin — Lightning Monitor

Live lightning strikes from the Blitzortung.org network, rendered directly on
the CloudTAK map. The user picks a center point (map click or manual lat/lon)
and a radius; strikes inside the fence appear as circles that fade from white
to dark red as they age, then drop off after the configured lifetime.

Based on the structure of
[dfpc-coe/CloudTAK-Plugin-Sample](https://github.com/dfpc-coe/CloudTAK-Plugin-Sample).

## Features

- **Center point picker** — "Pick Center on Map" (crosshair + single click) or manual lat/lon entry
- **Radius** — 5 to 200 mi slider; dashed yellow fence circle drawn on the map
- **Strike lifetime** — seconds before a strike ages off (default 120 s)
- Strikes colored by age (white → yellow → orange → dark red) with recent-strike list (time, distance, bearing)
- Bottom-bar bolt icon with live in-radius strike count
- Settings persisted in browser localStorage
- Clean teardown on plugin disable (layers, sources, websocket, timers)

## Install

CloudTAK glob-imports plugins from `api/web/plugins/*/index.ts` at build time.
This repo is laid out so `index.ts` and `lib/` sit at the repo root — catalog
installers can `git clone` it directly into place:

```bash
git clone <this-repo> /path/to/CloudTAK/api/web/plugins/lightning
cd /path/to/CloudTAK/api/web
npm install
npm run build     # or your existing CloudTAK web build/deploy step
```

No extra npm dependencies are required — the plugin only uses `vue`,
`maplibre-gl`, and `@tak-ps/vue-tabler`, all already present in the CloudTAK
web build.

## ⚠️ Production requirement: CSP allowance for the Blitzortung websocket

Production CloudTAK's nginx ships a Content-Security-Policy with
`connect-src 'self'` (plus the API host). A browser WebSocket to
`wss://ws*.blitzortung.org` is **blocked by that CSP** — the Start button will
silently fail on a stock production deployment. Local dev builds work because
they don't pass through the nginx CSP.

`upstream/cloudtak-csp-connect-extra.patch` in this repo patches
`api/nginx.conf.js` to support an env-configurable extension:

```bash
CSP_CONNECT_EXTRA="wss://*.blitzortung.org"
```

Until that (or an equivalent) lands upstream in dfpc-coe/CloudTAK, treat this
plugin as **dev-build-only**, or carry the patch in your own CloudTAK build.

## How it works

- Connects from the **browser** to a Blitzortung websocket
  (`ws1|ws7|ws8.blitzortung.org`), sends the `{"a":111}` subscription
  handshake, and LZW-decodes each frame into strike JSON
  (`time` in ns, `lat`, `lon`, ...). Rotates servers and auto-reconnects
  with a 3 s backoff.
- Haversine-filters strikes to the configured radius, then renders them into a
  `plugin-lightning-strikes` GeoJSON source with an age-driven circle layer.
  A 1 Hz timer re-computes age fractions and prunes expired strikes.
- Nothing is sent to the TAK server — this is client-side situational
  awareness only. (Server-wide sharing is what the Node-RED → CoT bridge
  is for.)

## Caveats

- Blitzortung's websocket protocol is community-reverse-engineered and
  unversioned; if they change the handshake or compression, the feed part of
  this plugin will need an update.
- Data is by Blitzortung.org and contributors: non-commercial, entertainment
  use only, and explicitly **not** to be used to protect people or equipment.
- Strike display is per-browser. Two users get independent centers/radii.
