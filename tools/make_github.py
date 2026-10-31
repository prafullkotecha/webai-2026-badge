#!/usr/bin/env python3
"""Print the contribution-heatmap data for app.js from a public GitHub profile.

usage: python3 tools/make_github.py [username]    (default: prafullkotecha)

Prints the `GH_DATA` line to paste into app.js (53 weeks x 7 days, levels 0-4, row-major Sun..Sat) and the
contributions total for the header text in drawGitHub(). Standard library only.
"""
import re, sys, urllib.request

USER = sys.argv[1] if len(sys.argv) > 1 else "prafullkotecha"
req = urllib.request.Request("https://github.com/users/%s/contributions" % USER, headers={"User-Agent": "Mozilla/5.0"})
html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")

cells = re.findall(r'<td[^>]*data-date="([\d-]+)"[^>]*data-level="(\d)"[^>]*>', html)
assert len(cells) == 371, "expected 53 weeks x 7 days, got %d cells" % len(cells)
total = re.search(r"([\d,]+)\s+contributions\s+in\s+the\s+last\s+year", html)
print('var GH_DATA = "%s";' % "".join(l for _, l in cells))
print("// %s contributions in the last year (header text in drawGitHub)" % (total.group(1) if total else "?"))
