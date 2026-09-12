# Music crate (`public/crate/`)

Club mode **prefers these CC0 mp3s** when present. Procedural beds in
`src/crate/proceduralCrate.js` remain as fallback if a file is missing or the
manifest has no file rows.

## Shipped CC0 tracks

| File | Title | Artist | Source |
| --- | --- | --- | --- |
| `alex-mcculloch-techno-5.mp3` | Techno 5 | Alex McCulloch / Pro Sensory | [Electronic](https://opengameart.org/content/electronic) |
| `alex-mcculloch-techno-3.mp3` | Techno 3 | Alex McCulloch / Pro Sensory | [Electronic](https://opengameart.org/content/electronic) |
| `ofdnd-funky-house.mp3` | Funky House | Of Far Different Nature | [Funky House](https://opengameart.org/content/funky-house) |
| `celestialghost8-nighttime-solitude.mp3` | Nighttime Solitude | celestialghost8 (~110 BPM) | [Nighttime Solitude](https://opengameart.org/content/nighttime-solitude) |
| `gichco-glowsphere.mp3` | Glowsphere | Gichco / obscure music | [Glowsphere](https://opengameart.org/content/glowsphere) |
| `gargette-kuia.mp3` | Kuia | James Gargette / cinameng (lo-fi techno) | [Kuia](https://opengameart.org/content/kuia) |
| `cryothene-console-floor.mp3` | And the Console Hit the Floor | Alex McCulloch / Pro Sensory | [CC0 upbeat collection](https://opengameart.org/content/cc0-upbeat-electronic-music) |
| `cryothene-alex-bouncy.mp3` | Bouncy Hamster Dancing | cynicmusic | [CC0 upbeat collection](https://opengameart.org/content/cc0-upbeat-electronic-music) |

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
