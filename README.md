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

This is a **Content-Security-Policy (CSP)** restriction, **not** CORS, and it
**cannot** be configured from the CloudTAK UI, admin panel, or this plugin’s
settings. Plugins are frontend-only; CSP is set by nginx inside `cloudtak-api`
when the container starts. A browser setting cannot loosen that header.

### Symptom

Feed stays on **Connecting…**. DevTools Console shows a `connect-src` violation
for `wss://ws*.blitzortung.org`. Local Vite/dev builds often work because they
do not serve the production nginx CSP.

### Fix (per deployment)

**1. Prefer env (newer CloudTAK only)** — if `api/nginx.conf.js` contains
`NGINX_CSP_`, allow the hosts and recreate the API container:

```bash
NGINX_CSP_CONNECT_SRC=wss://ws1.blitzortung.org,wss://ws7.blitzortung.org,wss://ws8.blitzortung.org
docker compose up -d cloudtak-api --force-recreate
```

Or in compose (avoids editing `.env`):

```yaml
cloudtak-api:
  environment:
    NGINX_CSP_CONNECT_SRC: wss://ws1.blitzortung.org,wss://ws7.blitzortung.org,wss://ws8.blitzortung.org
```

**2. Older CloudTAK (no `NGINX_CSP_` in `nginx.conf.js`)** — the env var is
**ignored**. Edit `CloudTAK/api/nginx.conf.js` on that host:

```js
'connect-src': [`'self'`, 'wss://ws1.blitzortung.org', 'wss://ws7.blitzortung.org', 'wss://ws8.blitzortung.org']
```

Then rebuild and recreate (must not be a fully cached no-op):

```bash
docker compose build cloudtak-api --no-cache
docker compose up -d cloudtak-api --force-recreate
```

**Verify** (must show `blitzortung` in `connect-src`):

```bash
curl -sI https://cloudtak.example.com/ | tr -d '\r' | grep -i content-security-policy
```

Quick check that the image supports the env approach:

```bash
docker exec cloudtak-api grep -n NGINX_CSP /home/etl/api/nginx.conf.js || echo 'old CloudTAK — patch nginx.conf.js instead'
```

### Why not a plugin setting?

| Idea | Works? |
|------|--------|
| Plugin / browser / admin UI toggle | No — cannot change HTTP CSP headers |
| CORS / “whitelist origin” admin | No — wrong mechanism |
| `NGINX_CSP_CONNECT_SRC` (newer CloudTAK) | Yes |
| Hardcode hosts in `api/nginx.conf.js` + rebuild (older CloudTAK) | Yes |
| Same-origin server proxy for Blitzortung | Yes, but needs a backend route outside this plugin |

Replicate the CSP change on every host that runs this plugin. Installing the
plugin alone is not enough. After a CloudTAK upgrade, re-check whether the
`nginx.conf.js` edit was overwritten and whether `NGINX_CSP_*` is available.

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
