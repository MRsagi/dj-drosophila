# Public deploy plan — DJ Drosophila

North star: **“Hey, I trained a fruit fly to DJ — this is its set.”** Shared live radio = the fly’s set. Ship club + story + lab; CC/procedural music; honest fine print. **Spotify is out.**

## Routes (hash SPA)

| Hash | View |
| --- | --- |
| `#club` (default) | Live club: Three.js fly DJ + dual-eye HUD + mixer meters + attribution footer |
| `#story` | Gag + truth: trained a fruit fly / MaleCNS proxies + mind; **not** conscious; credits |
| `#lab` | Full lab: file load, override, policy train/export, brain traces |

Hash routing needs **no** server redirects. `public/_redirects` and `vercel.json` are optional fallbacks if you later switch to path routes.

## Build

```bash
cd dj-drosophila
npm install
npm run build     # → dist/
npm run preview   # smoke-test locally
```

Deploy the **`dist/`** folder to any static host:

- **Cloudflare Pages** — connect repo or `wrangler pages deploy dist`
- **Netlify** — publish directory `dist` (uses `public/_redirects` → copied into dist)
- **Vercel** — framework preset Vite; `vercel.json` rewrites to `index.html`
- **GitHub Pages / any S3+CDN** — upload `dist/`; set root to `index.html`

First user gesture: **Enter the club** (Web Audio unlock). Bundled unsupervised model installs with `force: true` on load.

## Music crate policy

| Mode | Where | License |
| --- | --- | --- |
| **Preferred** | `public/crate/*.mp3` + `source:"file"` rows in `src/crate/manifest.json` | **CC0** (shipped) or **CC BY** |
| **Fallback** | Procedural beds via Web Audio (`src/crate/proceduralCrate.js`) | Treat as **CC0** for this demo |
| **Forbidden (public)** | Spotify embeds / private streaming APIs | — |

One optional **slot** in the manifest (`slot: true`) is a user drop placeholder (`public/crate/README.md`). Missing files fall back to a procedural stand-in.

Track picking: **prefer file tracks** when present, then energy/BPM proximity + unsupervised cluster bias + light randomness (`src/crate/cratePlayer.js`). File play length uses AudioBuffer duration. After GF/policy skip, the dumped deck advances to the next crate pick.

Full per-track table: repo root `LICENSES.md`.

Attribution footer on `#club` always lists active crate lines.

## What ships in the public experience

1. **3D Fly DJ** (`src/scene/FlyDJ.js` + `three`) — lean←xfader, bounce/glow←master, jump←skip, wing pulse←bass.
2. **Dual-eye viz** — smaller HUD on club; same analyser pipeline.
3. **Bundled model** — `src/models/unsupervised-v1.json` via `installBundledUnsupervised(..., { force: true })`.
4. **Story copy** — no consciousness claims; MaleCNS = actuators/proxies; unsupervised = stream structure.
5. **Lab** — existing features preserved under `#lab`.

## Pre-publish checklist

- [ ] `npm run build` passes
- [ ] Click **Enter the club** → audio + 3D animate
- [ ] `#story` shows credits (MaleCNS CC BY + music licenses)
- [ ] Attribution footer visible on `#club`
- [ ] No Spotify / no “fly is conscious” / no “fly learned DJ school”
- [ ] Shipped CC0 mp3s listed in `LICENSES.md`; optional user slot remains for drops

## File map (public additions)

```
src/scene/FlyDJ.js          Three.js club scene
src/crate/manifest.json     track list + slots
src/crate/proceduralCrate.js CC0-style procedural beds
src/crate/cratePlayer.js    load / pick / advance
src/ui/router.js            #club | #story | #lab
public/crate/README.md      crate file list + drop-in instructions
LICENSES.md                 per-track CC0 attribution
public/_redirects           Netlify SPA fallback
vercel.json                 Vercel rewrite
docs/PUBLIC.md              this file
```

## Honest one-liner for social

> MaleCNS-named actuators meet an unsupervised mixer policy. Consciousness not included. Music is CC/procedural — not Spotify.
