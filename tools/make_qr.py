#!/usr/bin/env python3
"""Generate the QR bitmap embedded in app.js.

Usage: python3 tools/make_qr.py [url]
Prints a JS snippet (QR_N, QR_STRIDE, QR_DATA) to paste into app.js.
Bits are row-major, MSB first, each row padded to a whole byte; 1 = dark.
"""
import base64, sys
import segno

URL = sys.argv[1] if len(sys.argv) > 1 else "https://www.linkedin.com/in/prafullkotecha"
qr = segno.make(URL, error="m", micro=False, boost_error=False)
rows = [list(r) for r in qr.matrix]
n = len(rows)
stride = (n + 7) // 8
buf = bytearray()
for r in rows:
    for b in range(stride):
        v = 0
        for i in range(8):
            c = b * 8 + i
            v = (v << 1) | (1 if c < n and r[c] else 0)
        buf.append(v)
print(f"// {URL}  (version {qr.version}, ECC {qr.error})")
print(f"var QR_N = {n}, QR_STRIDE = {stride};")
print(f'var QR_DATA = atob("{base64.b64encode(bytes(buf)).decode()}");')
