# Technical notes: WebAI badge firmware changes

Engineering notes for the patched `app.js` (upstream: espruino/BadgeApps `apps/webai`, v0.06) running on an Espruino ePaper Badge. User-facing summary and install steps are in the [README](../README.md). Everything here was measured or verified on hardware unless marked otherwise.

## Hardware and firmware

| | |
|---|---|
| Board | Espruino ePaper Badge, ESP32-C3, firmware 2v29.490 |
| Display | 3.97" 800x480, 4 colours: black 0, white 1, yellow 2, red 3 (2 bits/pixel) |
| USB | CDC serial, `COM3` on the dev machine (VID 303A:1001) |
| Storage | ~467 KB free flash before the GitHub work; `.bootcde` is the saved program |

The display is driven in portrait (480x800). In the raw buffer, one 200-byte row is one portrait column `x` (rows 0..479); pixel `c` in that row is portrait `y = 799 - c`, packed 4 pixels per byte, first pixel in the top bits.

## Power and wake behaviour

- The badge deep-sleeps ~10 s after waking. The USB port disappears while it sleeps.
- **Plugging in USB wakes it as a side-button (BTN1) press**, so the app redraws the screen on every replug. To flash or inspect it, unplug and replug the cable and connect inside the ~10 s window.
- `Badge.sleep()` ends every code path, which also turns the LEDs off.
- A keep-awake override for USB sessions is RAM-only: `clearInterval();clearTimeout();Badge.sleep=function(){};ESP32.deepSleep=function(){};`. **Always finish a session with `load()`** so a real boot clears it. A badge left awake drains the 250 mAh battery and keeps the LEDs on.
- `reset()` only clears RAM; it does **not** run the saved program. Use `load()` to start the app.
- At boot the app redraws the badge page only when `showing != "badge"` (the `showing` Storage file records the current screen: `badge`, `gh0`, `gh1`, `gh2`).

## Files on the badge

| file | owner | notes |
|---|---|---|
| `.bootcde` | this repo (`app.js`) | the program |
| `repos.json` | `tools/make_repos.py` | 20 repositories + language mix; **not in git** |
| `badge.epaper` | conference server | 96000 B photo/name/company image, re-downloaded by the firmware; never modify |
| `id.json`, `wifi.json`, `scans.txt`, `connections.json`, `app.info`, `pair.epaper`, `connect.epaper` | firmware | leave alone |
| `showing` | app | current screen |

## Rendering

`Badge.showImageFileRendering(file, 48, cb)` only exposes the first 48 rows (the 48 px left strip in portrait), so anything elsewhere is clipped. `renderBands(file, cb)` instead uses `Badge.showRaw(function(eD, resolve){...})` and streams the screen to the panel in 10 bands of 48 columns (9600 bytes each). Per band it:

1. fills the band buffer from `file` (`Storage.read(file, y*200, 9600)` -> `E.toArrayBuffer` -> `Uint8Array.set`) or with white (`0x55`) for generated pages;
2. calls `cb(g, dx)` with the band's `Graphics` buffer rotated to portrait; `dx = -y` shifts portrait x into band coordinates (visible range `0..47`);
3. sends the band with `eD()` and lights one more LED (progress bar), then `resolve()` after the last band.

`cleanBand()` whitens everything outside two rounded boxes (`BOXES`) with native `fillRect`s; corner pieces are computed once and cached. `drawQR(g, dx, data, scale, x, y)` draws a version-3 QR (29 modules, ECC M) and skips bands it does not touch. All page drawing is clipped to the band by `Graphics`, so the same drawing code runs for every band.

### Screens

| `showing` | contents |
|---|---|
| `badge` | server image with background/`#WebAI` removed, LinkedIn QR, connection counter |
| `gh0` | name, GitHub URL, QR, contributions total, 4 highlighted repos, language bar, 53x7 heatmap |
| `gh1`, `gh2` | 8 more repositories each |

Short press (`btn1Pressed(false)`): `badge` <-> `gh0` (from `gh1`/`gh2` back to `badge`). Hold, i.e. BTN1 still down after the 1 s check in `startup()`: `badge`/`gh0` -> `gh1` -> `gh2` -> `gh0`. A true double-press is not practical: the badge sleeps after each draw, so a second press would have to land while the CPU is busy drawing.

## Performance (the main lesson)

The interpreter is slow, roughly **0.2-0.3 ms per executed operation**; indexing into a flash-backed string is slower again. Anything per pixel or per row costs minutes. Measured on the badge:

| work | cost | fix |
|---|---|---|
| per-pixel icon loop (`setPixel` + `charCodeAt`, ~55k pixels) | ~35 s for one 48 px band, ~3.5 min for the page | removed icons from the design |
| `Graphics.drawImage` of 2-bit image with palette | ~7 s for two icons in a band and wrong colours (CRC differed from the loop) | not used |
| per-row byte-mask background clean-up (`cleanRow`, 480 rows) | **83.7 s** of a 93 s draw | native `fillRect`s: output identical (0 differing pixels, checked offline on the real image) |
| QR, all 841 modules every band | 9 s | only module columns inside the band, vertical runs merged: identical output |
| reading the photo per band | 0.3 s total | fine as is |
| panel refresh | not separable from the numbers above; total page time is now 10-15 s | n/a |

Result: badge page 96 s -> ~10 s; GitHub pages ~10-15 s. Rule: use `fillRect`, `Uint8Array.set`, `E.toArrayBuffer`, `Storage.read(name, offset, len)`; avoid per-pixel/per-row JS, and measure phases on the device before guessing (my first hypothesis, string indexing, was wrong: the file read took 0.3 s).

Offline checks that gated each flash (host-side Node scripts, not committed): band-by-band rendering vs full-canvas rendering, old vs new clean-up on the real `badge.epaper` (0 differing pixels), old vs new QR drawing (0 differing pixels).

## Flashing over USB

The Web IDE upload and long single-line writes are unreliable: host-to-badge serial drops characters (roughly a third of 256-byte chunks arrive corrupt), while badge-to-host reads are reliable. What works:

1. **Back up first.** Read the file in 512-byte pieces printed as `btoa()` with a per-piece CRC; check the CRC on the host and re-request bad pieces; check the total length and `E.CRC32`. Original v0.06 `.bootcde`: 8689 bytes, CRC32 1826498463.
2. **Stage in chunks.** Send each 256-byte chunk as base64 with `espruino -p COM3 --config RESET_BEFORE_SEND=false --config SERIAL_THROTTLE_SEND=1 ...`; the badge saves it as Storage file `wc_<offset>` only if `E.CRC32` matches and the read-back CRC matches. Repeat for missing chunks until all are present (resumable). When two scripts ran at once one staged chunk ended up 1 byte long and the assembled file's CRC was wrong even though every chunk had been verified at upload; comparing each staged chunk's length+CRC on the badge against the local file found it, and erasing and restaging that chunk fixed it.
3. **Assemble.** `Storage.write(target, chunk, offset, totalLength)` for each chunk by offset, then read back length and CRC32. Files written with offset/total are invisible until complete.
4. **Finish.** Erase `wc_*`, set `showing` to `badge` so the app redraws, and start with `load()`.
5. Never touch `id.json`, `badge.epaper`, `scans.txt`, `wifi.json`.

Operational pitfalls: run **one** flash script at a time (two fight over `COM3`: "Access denied" / endless "query failed"); do not background a script with `&` inside a background task (it gets killed with the task); a `Badge.epaperBusy` check protects against starting a draw while the panel is refreshing (`Uncaught Error: ePaper is busy`).

## Data tooling

- `tools/make_qr.py <url>`: QR constants (`QR_N`, `QR_STRIDE`, `QR_DATA`) for `app.js`; needs `segno`.
- `tools/make_github.py [user]`: `GH_DATA` (371 levels, 53 weeks x 7 days) and the contributions total from the public profile.
- `tools/make_repos.py repos.list [out.json]`: `repos.json` from a local list (`name|Language|description <= 34 chars`, 20 lines, first 4 = highlights); language mix counted with `gh`. Keep the list and the JSON out of git, since the list can name private repositories (the repo is public).

## Limits and ideas

- GitHub data is a snapshot baked in at flash time (heatmap) or at `make_repos.py` time (repositories); regenerate and re-flash to refresh.
- Only four panel colours; language dots reuse them, so the 2-letter language label is what actually identifies a language.
- The hold gesture is deliberately simple; a longer-lived "mode" (e.g. toggling pages with BTN2) would be an alternative if holding feels awkward.
