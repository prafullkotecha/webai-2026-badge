# WebAI 2026 badge – LinkedIn QR

Patched copy of the WebAI badge firmware ([espruino/BadgeApps `apps/webai`](https://github.com/espruino/BadgeApps/tree/master/apps/webai), v0.06) that overlays a QR code on the badge front, between the company name and `#WebAI`. Scanning it opens <https://www.linkedin.com/in/prafullkotecha>.

Hardware: [Espruino ePaper Badge](https://www.espruino.com/Badge) – ESP32-C3, 3.97" 800x480 4-colour (B/W/Y/R) ePaper, WiFi + BLE, 250mAh battery.

## How it works

The name / photo / company image is rendered by the conference server and stored on the badge as `badge.epaper` (800x480, 2 bits per pixel, 96000 bytes). The firmware draws the connection counter on top of it locally in `showBadge()`; the QR is drawn the same way (`drawQR()`), so it survives re-downloads, resets and connection-count updates. No server change needed.

**Why a custom render loop:** the firmware's `Badge.showImageFileRendering(file, 48, cb)` only hands the callback the first 48 rows of the image (the 48px-wide left strip in portrait, where the counter lives) and sends the rest unmodified, so a QR anywhere else is silently clipped. `renderBadge()` instead uses `Badge.showRaw()` to stream the whole image in 48-row bands and runs the overlay on each band (`cb(g, dx)`, `dx` = x shift for that band).

Diff vs. upstream: `QR_*` constants, `drawQR()`, `renderBadge()`, and `showBadge()` calling `renderBadge()`. First commit is the untouched upstream file.

## Install

The badge deep-sleeps ~10s after waking, which drops USB/BLE mid-transfer, and the USB serial link loses characters on long lines. What worked on hardware:

1. **Back up first:** read `.bootcde` and check its length and `E.CRC32()` (original v0.06 was 8689 bytes, CRC 1826498463). The Web IDE's Storage download times out over BLE; printing `btoa()` in 512-byte pieces with a CRC per piece and checking them locally is reliable.
2. **Keep the badge awake while transferring** (RAM only, cleared by `reset()`): `clearInterval();clearTimeout();Badge.sleep=function(){};ESP32.deepSleep=function(){};`. Remember to `reset()` afterwards or the badge never sleeps and the LEDs stay on.
3. Send `app.js` over USB (`espruino -p COM3 --config RESET_BEFORE_SEND=false --config SERIAL_THROTTLE_SEND=1 ...`) as 256-byte base64 chunks, each saved as its own Storage file (`wc_<offset>`) only if its CRC matches on the badge. Resend only the missing chunks until all are present.
4. Write `.bootcde` from the chunk files by offset (`Storage.write('.bootcde', chunk, offset, total)`), read it back and compare length + CRC32, then erase the `wc_*` files. Leave `id.json`, `badge.epaper`, `scans.txt`, `wifi.json` alone.
5. Set `showing` to anything but `badge`, then `reset()`: on boot the app only redraws the screen when `showing != "badge"`.

## Tuning

Screen is 480x800 portrait (`setRotation(1)`; portrait x = physical row, y = physical column). Adjust in `app.js`:

| const | meaning | default |
|---|---|---|
| `QR_Y` | top of white box (px) | 592 |
| `QR_SCALE` | px per QR module | 4 (box 124x124) |
| `QR_MARGIN` | white quiet-zone modules | 1 |

## Change the URL

```bash
pip install segno
python3 tools/make_qr.py https://www.linkedin.com/in/prafullkotecha
```

Paste the printed `QR_N / QR_STRIDE / QR_DATA` over the block in `app.js`.

## Verified

Flashed to an Espruino ePaper Badge (firmware 2v29.490) over USB: `.bootcde` read back with matching length and CRC32, QR visible between the company name and `#WebAI`, connection counter unchanged. Scan check of the code is up to you.
