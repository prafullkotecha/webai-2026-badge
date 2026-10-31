# WebAI 2026 badge – LinkedIn QR, clean layout, GitHub pages

Patched copy of the WebAI badge firmware ([espruino/BadgeApps `apps/webai`](https://github.com/espruino/BadgeApps/tree/master/apps/webai), v0.06). The badge front gets a QR code to <https://www.linkedin.com/in/prafullkotecha> on a plain white layout (no background, no `#WebAI`), and the agenda page is replaced by GitHub profile pages: contribution heatmap, language mix, a GitHub QR and 20 repositories.

Hardware: [Espruino ePaper Badge](https://www.espruino.com/Badge) – ESP32-C3, 3.97" 800x480 4-colour (B/W/Y/R) ePaper, WiFi + BLE, 250mAh battery.

## Buttons

| action | result |
|---|---|
| short press side button (BTN1) | badge page <-> GitHub highlights page |
| hold it past the 1 s check at wake | "More projects" pages 2 -> 3 -> highlights; short press from there returns to the badge |
| BTN2 | scan, as upstream |

The button press lights all 10 LEDs amber; each finished 48px band of the screen turns one white (a progress bar), and the LEDs go off when the badge sleeps. Plugging in USB also wakes it as a button press, which redraws the screen.

## How it works

The name / photo / company image is rendered by the conference server and stored on the badge as `badge.epaper` (800x480, 2 bits per pixel, 96000 bytes). The firmware draws the connection counter on top of it locally in `showBadge()`; the QR is drawn the same way (`drawQR()`), so it survives re-downloads, resets and connection-count updates. No server change needed.

**Why a custom render loop:** the firmware's `Badge.showImageFileRendering(file, 48, cb)` only hands the callback the first 48 rows of the image (the 48px-wide left strip in portrait, where the counter lives) and sends the rest unmodified, so a QR anywhere else is silently clipped. `renderBands()` instead uses `Badge.showRaw()` to stream the whole image in 48-row bands and runs the overlay on each band (`cb(g, dx)`, `dx` = x shift for that band).

**Layout:** `cleanBand()` keeps only the two rounded boxes in `BOXES` (photo and name card, measured from `badge.epaper`) and fills everything else white with native `fillRect`s (corner pieces are cached), which removes the polygon background and the `#WebAI` text. The QR (186px, scale 6) sits below the name card; the connection counter and icon are drawn in black.

**Speed:** interpreted JS on this chip is slow (~0.2 ms per operation, and indexing into a flash-backed string is slower still), so the page code does as little per-pixel/per-row work as possible. An earlier per-row byte-mask clean-up cost ~84 s per draw and a per-pixel icon loop ~3.5 min; with native fills, per-band reads and QR columns clipped to each band, every page now draws in 10-15 s. Rule of thumb: use `fillRect`/`Uint8Array.set`, never per-pixel loops.

**GitHub pages:** `drawGitHub(g, dx, page)`. Page 0: header with name, URL, contributions total and QR; four highlighted repositories; a stacked language bar; the heatmap (`GH_DATA`, two rows of 27 weeks). Pages 1-2: eight repositories each. Repository data lives in `repos.json` on the badge (read once per draw, freed afterwards), **not in this repo**, because it can name private repositories.

Diff vs. upstream: `QR_*` constants, `BOXES`, `cleanBand()`, `drawQR()`, `renderBands()`/`renderBadge()`, `showBadge()` using them, the `GH_*` data and `drawGitHub()`/`renderGitHub()`/`showGitHub()`, and `btn1Pressed(hold)`. First commit is the untouched upstream file.

## Install

The badge deep-sleeps ~10s after waking, which drops USB/BLE mid-transfer, and the USB serial link loses characters on long lines. What worked on hardware:

1. **Back up first:** read `.bootcde` and check its length and `E.CRC32()` (original v0.06 was 8689 bytes, CRC 1826498463). The Web IDE's Storage download times out over BLE; printing `btoa()` in 512-byte pieces with a CRC per piece and checking them locally is reliable.
2. **Keep the badge awake while transferring** (RAM only, cleared by `reset()`): `clearInterval();clearTimeout();Badge.sleep=function(){};ESP32.deepSleep=function(){};`. Remember to `reset()` afterwards or the badge never sleeps and the LEDs stay on.
3. Send `app.js` over USB (`espruino -p COM3 --config RESET_BEFORE_SEND=false --config SERIAL_THROTTLE_SEND=1 ...`) as 256-byte base64 chunks, each saved as its own Storage file (`wc_<offset>`) only if its CRC matches on the badge. Resend only the missing chunks until all are present.
4. Write `.bootcde` from the chunk files by offset (`Storage.write('.bootcde', chunk, offset, total)`), read it back and compare length + CRC32, then erase the `wc_*` files. Leave `id.json`, `badge.epaper`, `scans.txt`, `wifi.json` alone.
5. Set `showing` to anything but `badge` (the app only redraws on boot when `showing != "badge"`), erase the temp files, then start the app with **`load()`**. `reset()` only clears RAM and does not run the saved program, so the badge just sits awake and empty (amber LEDs may stay on) until the next real wake. The screen takes ~10-15s to refresh.
6. Also upload `repos.json` (below) the same way (5 chunks) before the first press of the side button; without it the GitHub pages show no repositories. If the badge is asleep and not on USB, unplug and replug the cable to wake it for ~10 s.

More detail (rendering, timings, flashing pitfalls): [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Tuning

Screen is 480x800 portrait (`setRotation(1)`; portrait x = physical row, y = physical column). Adjust in `app.js`:

| const | meaning | default |
|---|---|---|
| `QR_Y` | top of white box (px) | 593 |
| `QR_SCALE` | px per QR module | 6 (box 186x186) |
| `QR_MARGIN` | white quiet-zone modules | 1 |

## Repositories and heatmap data

```bash
python3 tools/make_github.py                 # GH_DATA + contributions total, paste into app.js
python3 tools/make_repos.py repos.list repos.json   # needs `gh` logged in
```

`repos.list` is one line per repository, `name|Language|description up to 34 chars`, the first four being the highlights, 20 in total. Keep it out of git (`backup/` is ignored) and upload `repos.json` to the badge's Storage. The language bar is computed from all your non-fork repositories.

## Change the URL

```bash
pip install segno
python3 tools/make_qr.py https://www.linkedin.com/in/prafullkotecha
```

Paste the printed `QR_N / QR_STRIDE / QR_DATA` over the block in `app.js`.

## Verified

Flashed to an Espruino ePaper Badge (firmware 2v29.490) over USB: `.bootcde` and `repos.json` read back with matching length and CRC32; badge page, GitHub highlights and both project pages confirmed on the display. Measured draw time per page: ~10-15 s.
