# WebAI 2026 badge – LinkedIn QR

Patched copy of the WebAI badge firmware ([espruino/BadgeApps `apps/webai`](https://github.com/espruino/BadgeApps/tree/master/apps/webai), v0.06) that overlays a QR code on the badge front, between the company name and `#WebAI`. Scanning it opens <https://www.linkedin.com/in/prafullkotecha>.

Hardware: [Espruino ePaper Badge](https://www.espruino.com/Badge) – ESP32-C3, 3.97" 800x480 4-colour (B/W/Y/R) ePaper, WiFi + BLE, 250mAh battery.

## How it works

The name / photo / company image is rendered by the conference server and stored on the badge as `badge.epaper`. The firmware already draws the connection counter on top of it locally (`showBadge()`); the QR is drawn the same way (`drawQR(g)`), so it survives re-downloads, resets and connection-count updates. No server change needed.

Diff vs. upstream: `QR_*` constants + `drawQR()` + one `drawQR(g);` call in `showBadge()`. First commit is the untouched upstream file.

## Install

1. Open the [Espruino Web IDE](https://www.espruino.com/ide/), connect over USB/BLE. The badge sleeps quickly after power-on: connect, then type `reset()` straight away.
2. **Back up first:** Storage → download `.bootcde` (original firmware).
3. Upload `app.js` from this repo to Storage with file name `.bootcde`. Leave the other files (`id.json`, `badge.epaper`, `scans.txt`, `wifi.json`) alone so you keep your identity and connections.
4. Refresh the screen: press the side button (or power-cycle). The QR appears with the connection count update.

Tip: `Badge.showRendering = Badge.dumpRendering` then `showBadge()` dumps a preview to the IDE without touching the display.

## Tuning

Positions are estimated from a photo of the badge (screen is 480x800 portrait; gap ~y 587–719). Adjust in `app.js`:

| const | meaning | default |
|---|---|---|
| `QR_Y` | top of white box (px) | 592 |
| `QR_SCALE` | px per QR module | 4 (box 124x124) |
| `QR_MARGIN` | white quiet-zone modules | 1 |

For exact placement, download `badge.epaper` from Storage and measure the gap.

## Change the URL

```bash
pip install segno
python3 tools/make_qr.py https://www.linkedin.com/in/prafullkotecha
```

Paste the printed `QR_N / QR_STRIDE / QR_DATA` over the block in `app.js`.

## Verified

Ran `drawQR()` in Node against a mock 480x800 canvas and decoded the output with OpenCV → `https://www.linkedin.com/in/prafullkotecha`. **Not tested on hardware** (built in a cloud sandbox).
