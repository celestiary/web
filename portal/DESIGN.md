# Pixel-Perfect Social Preview via Headless Portal Proxy

## Context

Permalinks just landed (`js/permalink.js`) and they're pixel-perfect: same URL → same scene, deterministic. The earlier idea (per-body static pages + hand-curated hero JPGs) couldn't honor that — the unfurl would always be a generic body shot, never the actual scene the user shared. This design pivots to a **headless rendering proxy** that loads the live permalink, awaits scene-ready, and PNGs the real frame.

A parallel project, [`pablo-mayrgundter/portal`](https://github.com/pablo-mayrgundter/portal), defines a `PortalMessage` protocol for embedding 3D apps as live portals. Its vocabulary (`portal:ready`, `portal:setCamera`, `portal:setTime`, `PortalCapabilities`, `Pose`/`Vec3`/`Quat`) is almost exactly the contract a screenshot proxy needs. By implementing a small subset of that protocol in celestiary, the proxy becomes generic — a "headless portal client" that can serve celestiary, portal demos, and any future portal-compliant 3D app.

Goal: pasting a celestiary permalink anywhere unfurls into the actual rendered scene, with a meaningful title and description, served from a standalone proxy with no code-level coupling to celestiary.

## Approach

Three deliverables: a documented **protocol surface** (subset of portal + a small OG extension), a thin **endpoint implementation** in celestiary, and a **separate proxy repo** that screenshots any portal-compliant URL.

### Protocol decision

Implement parallel — do **not** import `portal-core` from portal yet. portal is unpublished TS+Vite; celestiary is plain JS+esbuild. Coupling now means dragging tsc in or vendoring artifacts with no semver to anchor either side. Document the contract textually here in `portal/DESIGN.md` (this file) plus a short surface reference in `portal/PROTOCOL.md`, copy the type names verbatim, reimplement in plain JS. Phase 3 (after both projects stabilize) extracts a published `@portal/protocol` package.

**Minimum subset celestiary implements for v1:**
- `window.celestiary.ready` — Promise that resolves once the scene has rendered N=2 frames after the most recent target-load *and* the camera tween is null. This is what makes the screenshot deterministic.
- `window.celestiary.getCapabilities()` → `{renderStream:false, ..., cameraControl:false, socialPreview:true}`.
- `window.celestiary.getOG()` → `{title, description, body, card:'summary_large_image'}`.
- `window.celestiary.version` — the build's app-version, also surfaced as `<meta name="app-version">`.

`portal:setCamera`/`setTime`/`pick` are deferred — permalinks already carry full pose+time, so v1 needs no remote control.

### Protocol extension for OG

portal doesn't define social-preview metadata. Propose this minimal extension (document here; later upstream as a PR to portal):

```
capability: socialPreview: boolean
endpoint:   getOG(): Promise<OGMetadata>

OGMetadata = {
  title: string,
  description: string,
  body?: string,                                  // canonical id, e.g. "sun/earth"
  image?: string,                                 // override URL; celestiary leaves null
  tags?: string[],
  card?: 'summary' | 'summary_large_image'        // default summary_large_image
}
```

This belongs in protocol-land (every portal app eventually wants social previews), not in celestiary internals.

### Celestiary changes (small)

All wiring sits in `js/Celestiary.js`:
- After `window.c = this` (line 82), install `window.celestiary = { ready, getCapabilities, getOG, version }`.
- The `ready` promise is created once; resolution is gated on a frame counter that decrements inside the existing `animCb` (line 47) and re-arms in `onDone` (line 175). Resolve when counter hits 0 and `Shared.targets.tween === null` (camera settled).
- `getOG()` synthesizes title from the committed body path (e.g., `sun/earth/moon` → "Earth's Moon — Celestiary"); description uses lat/lng/alt already computed in `_schedulePermalinkUpdate` (~line 555–565) plus formatted `this.time`.
- A helper `displayTitleFromPath(path)` lives in `js/permalink.js` next to `pathFromFragment` for reuse.

UI:
- Share button in `js/App.jsx` inside `<div id='text-buttons'>` (line 65), peer of About/Settings: `<TooltipToggleButton tip='Share' icon={<ShareIcon/>} onClick={shareHandler}/>`. Handler builds `https://og.celestiary.dev${location.pathname}${location.hash}` and calls `navigator.clipboard.writeText` + a toast.

Build/HTML:
- `public/index.html`: add `<meta name="app-version" content="__APP_VERSION__">`, plus default `og:image`/`og:title`/`twitter:card` for non-proxy direct visits.
- `esbuild/common.js` (or `build.js`): add a `define` for `__APP_VERSION__` (read from `package.json#version` or `git rev-parse --short HEAD`).

No URL restructuring. No per-body HTML. No hero JPGs.

### Proxy repo (separate, generic)

**Repo:** `pablo-mayrgundter/portal-snapshot-proxy` — generic name so it can serve portal demos too. Celestiary deploys it under `og.celestiary.dev` via Cloudflare custom hostname.

**Stack:** TypeScript on Cloudflare Workers + Browser Rendering binding, R2 for cache, Hono for routing. Single deploy, no VM.

**Endpoints:**
- `GET /*` — match `User-Agent` against a crawler regex (`Twitterbot|facebookexternalhit|Slackbot|Discordbot|LinkedInBot|WhatsApp|TelegramBot|Pinterest|Applebot|Googlebot`). Crawler → render path. Non-crawler → 302 to `https://celestiary.dev<path>` plus a meta-refresh body (some UAs drop fragments on redirect; belt-and-suspenders).
- `GET /img/<sha256>.jpg` — R2 lookup, render-on-miss.

**Render flow:**
1. Open Browser Rendering page; `setViewport({width:1200, height:630, deviceScaleFactor:1})`.
2. `page.goto(originURL, { waitUntil:'networkidle' })`.
3. `await Promise.race([page.evaluate(()=>window.celestiary.ready), timeout(7000)])`.
4. `const og = await page.evaluate(()=>window.celestiary.getOG())`.
5. Screenshot JPEG quality 82, clip to 1200×630.
6. `R2.put(key, buf, { customMetadata: og })`.

**Cache key:** `sha256(originURL_with_fragment + '|' + appVersion)`. Permalinks are deterministic; appVersion bump invalidates everything for free. No purge endpoint needed.

### OG HTML returned to crawlers

```html
<!doctype html><html><head>
<meta charset="utf-8">
<title>{{og.title}}</title>
<link rel="canonical" href="{{originURL}}">
<meta http-equiv="refresh" content="0; url={{originURL}}">
<meta property="og:type" content="website">
<meta property="og:title" content="{{og.title}}">
<meta property="og:description" content="{{og.description}}">
<meta property="og:url" content="{{originURL}}">
<meta property="og:image" content="https://og.celestiary.dev/img/{{sha}}.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{og.title}}">
<meta name="twitter:description" content="{{og.description}}">
<meta name="twitter:image" content="https://og.celestiary.dev/img/{{sha}}.jpg">
</head><body><script>location.replace({{originURL|json}})</script></body></html>
```

Three-layer fallthrough for non-crawlers that slip past UA matching: `Location:` header (clean clients), meta refresh (older bots), JS replace (everyone else).

### Hosting

**Cloudflare Workers + Browser Rendering + R2.** Scales to zero (idle ~$0); R2 zero egress; Browser Rendering bills per session-second (~$0.09/hr); single deploy. Risk is bounded — fall back to a Fly.io Playwright service behind the same Worker if Browser Rendering misbehaves with Three.js+SwiftShader.

## Files to modify in celestiary

- `js/Celestiary.js` — `window.celestiary` endpoint, frame-gated `ready`, `getCapabilities()`, `getOG()`. Frame counter wired into `animCb` (line 47); reset in `onDone` (line 175 success branch).
- `js/permalink.js` — export `displayTitleFromPath(path)`.
- `js/App.jsx` — Share button at line 65 inside `<div id='text-buttons'>`.
- `public/index.html` — `<meta name="app-version">` + default OG/Twitter fallbacks.
- `esbuild/common.js` (or `build.js`) — `define: { __APP_VERSION__: JSON.stringify(version) }`.
- `portal/DESIGN.md` (this file).
- `portal/PROTOCOL.md` (new) — concise reference of the implemented protocol surface, with a link to portal's `portal-core` types.

## Verification

- **Endpoint smoke (DevTools on celestiary):** `await window.celestiary.ready; await window.celestiary.getOG()` returns populated metadata after navigating to a body.
- **Local proxy ↔ origin:** `yarn start` celestiary on `:8000`; `wrangler dev` proxy on `:8787`; `curl -A 'Twitterbot/1.0' http://localhost:8787/sun/earth/#@51.5,-0.1,412km;t=...` returns OG HTML; `curl -A 'Mozilla/5.0' …` returns 302 to origin.
- **Crawler matrix:** Twitterbot, facebookexternalhit, Slackbot-LinkExpanding, Discordbot, LinkedInBot.
- **Live validators:** Twitter Card Validator, Facebook Sharing Debugger, LinkedIn Post Inspector, opengraph.xyz; paste into a private Discord/Slack channel.
- **Determinism:** screenshot the same permalink twice → identical R2 key → identical bytes (within JPEG re-encode tolerance).

## Risks

- **Cold start vs Twitterbot's ~10 s budget.** Browser Rendering cold start ≈ 2–3 s. Mitigate with a Worker `scheduled` cron hitting a known URL every 5 min to keep a warm browser pool.
- **Three.js in headless Chromium.** WebGL via SwiftShader is functional but `UNMASKED_RENDERER_WEBGL` reports SwiftShader. Audit celestiary for any GPU-only branches (atmosphere shaders are the likely suspect); gate on a `?renderingForOG=1` query the proxy injects if needed.
- **Permalink format drift.** Cached images go stale on `encodePermalink` change — solved by including `appVersion` in the cache key.
- **Protocol drift between celestiary and portal.** Mitigate via this `DESIGN.md` plus a CI smoke test in the proxy repo that boots both apps and asserts identical capability shape.
- **Fragment-in-302.** Some UAs drop fragments on redirect. Always emit the meta-refresh fallback alongside `Location:`.
- **Cost at scale.** ~$0.004/day for 100 cache-miss renders. Cache hit ratio should be >95% because permalinks are content-addressed.
- **Crawler UA bypass.** Generous regex; missing a UA just means a normal user gets a 302 — harmless.

## Sequencing

**Phase 1 (~3 days, ships a working preview):**
- `portal/DESIGN.md` + `portal/PROTOCOL.md`.
- `window.celestiary.{ready, getCapabilities, getOG, version}` in `Celestiary.js`.
- `__APP_VERSION__` esbuild define + `<meta name="app-version">`.
- Default OG fallbacks in `index.html` for direct visits.
- Proxy repo with crawler-vs-302 split, R2 cache, fixed 1200×630 capture at the permalink's native framing.
- Share button.
- Twitter Card Validator green.

**Phase 2 (~1 week, better framing):**
- Implement `setCamera`/`setTime` so the proxy can request OG-optimal framing (body at 0.4× viewport width, ¾-lit). `getOG()` returns a recommended `Pose`.
- Plumb through `ThreeUi.setFov` and `Scene.cameraTo`.

**Phase 3 (consolidate, when both projects stabilize):**
- Publish `@portal/protocol` as a real npm package with `.d.ts`. Celestiary imports types (esbuild handles TS). Proxy depends on the same package. Upstream `socialPreview` capability + `getOG()` to portal.
