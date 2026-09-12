# Music crate (`public/crate/`)

Club mode **prefers these CC0 mp3s** when present. Procedural beds in
`src/crate/proceduralCrate.js` remain as fallback if a file is missing or the
manifest has no file rows.

## Shipped CC0 tracks

| File | Title | Artist | Source |
| --- | --- | --- | --- |
| `fupi-technomania101.mp3` | Technomania101 | Fupi | [Technomania101](https://opengameart.org/content/technomania101-2000s-europop-electronic-dance-music) |
| `mrpoly-techno-geek.mp3` | tEcHNo gEeK | mrpoly | [tEcHNo gEeK](https://opengameart.org/content/techno-geek) |
| `zane-little-drive.mp3` | Drive | Zane Little Music | [Drive](https://opengameart.org/content/drive-0) |
| `mintodog-ocean-trance.mp3` | Ocean Trance | MintoDog (140 BPM) | [Ocean Trance](https://opengameart.org/content/ocean-trance) |
| `deva-takeover.mp3` | Takeover (Abyss) | Deva / Kuesopop | [Takeover](https://opengameart.org/content/kuesopop-takeover-electronic-music) |
| `vitalezzz-celestial-harmony.mp3` | Celestial Harmony | vitalezzz | [Celestial Harmony](https://opengameart.org/content/celestial-harmony) |
| `vitalezzz-hyperspace.mp3` | Hyperspace | vitalezzz | [Hyperspace](https://opengameart.org/content/hyperspace) |
| `iamoneabe-freeflow.mp3` | Freeflow | iamoneabe | [Freeflow](https://opengameart.org/content/freeflow) |

Full license table: repo root [`LICENSES.md`](../../LICENSES.md).

Manifest: `src/crate/manifest.json` (`source: "file"`, `file: "/crate/<name>.mp3"`, `slot: false`).

## Drop-in another track

1. Find a track licensed **CC0** or **CC BY**.
2. Save as `.mp3` here (e.g. `public/crate/slot-user.mp3`).
3. Edit `src/crate/manifest.json`: either flip the existing `[SLOT]` row
   (`slot: false`, fill title/artist/license/bpm/energy/attributionUrl) or add a
   new row with `"source": "file"` and `"file": "/crate/your-file.mp3"`.
4. Rebuild / redeploy. The Club attribution footer reads the manifest.

## Policy

- **Spotify embeds / private streaming APIs are OUT** for the public site.
- Prefer CC0; if CC BY, keep the author + URL visible in the footer.
- Do not ship copyrighted commercial tracks without a redistribution license.
- Club setEngine uses each file’s **AudioBuffer duration** for planned play length.

## Procedural fallback IDs

| proceduralId | vibe | BPM-ish |
| --- | --- | --- |
| house-pulse | four-on-floor house | 122 |
| techno-lattice | harder techno | 130 |
| ambient-r8 | soft / cool-down | 92 |
| bass-tunnel | deep bass | 118 |
| psy-facet | psy peak energy | 142 |
| break-escape | breakbeat skip fuel | 168 |
