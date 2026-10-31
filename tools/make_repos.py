#!/usr/bin/env python3
"""Build repos.json for the badge's GitHub pages from a local, private list of repositories.

usage: python3 tools/make_repos.py repos.list [out.json]

repos.list: one repository per line, "name|Language|one-line description (<=34 chars)". The first four lines
are the highlights shown on the first page. Keep the list OUT of git (it can name private repositories);
upload the output to the badge's Storage as "repos.json" (see README). The language mix is counted with
`gh` over all your non-fork repositories. Needs the GitHub CLI, logged in.
"""
import json, subprocess, sys
from collections import Counter

COL = {"TypeScript": 2, "JavaScript": 3, "Rust": 0, "Java": 0, "Kotlin": 3, "Python": 2, "HTML": 2, "Dart": 3}  # badge: 0 black, 2 yellow, 3 red
SHORT = {"TypeScript": "TS", "JavaScript": "JS", "Kotlin": "Kt", "Python": "Py", "-": "-"}

rows = []
for line in open(sys.argv[1], encoding="utf-8"):
    if line.strip():
        name, lang, desc = [p.strip() for p in line.rstrip("\n").split("|")]
        assert len(desc) <= 34, "description too long: " + name
        rows.append([name, SHORT.get(lang, lang), desc, COL.get(lang, 0)])
assert len(rows) == 20, "expected 20 repositories, got %d" % len(rows)

q = ('query($endCursor:String){viewer{repositories(first:100,after:$endCursor,ownerAffiliations:OWNER,isFork:false)'
     '{pageInfo{hasNextPage endCursor} nodes{primaryLanguage{name}}}}}')
out = subprocess.run(["gh", "api", "graphql", "--paginate", "-f", "query=" + q,
                      "--jq", ".data.viewer.repositories.nodes[].primaryLanguage.name"],
                     capture_output=True, text=True, check=True).stdout.split()
langs = Counter(l for l in out if l != "null")
total = sum(langs.values())
top = langs.most_common(3)
mix = [[SHORT.get(l, l), round(100 * n / total), COL.get(l, 0)] for l, n in top]
mix.append(["other", 100 - sum(m[1] for m in mix), 1])
open(sys.argv[2] if len(sys.argv) > 2 else "repos.json", "w").write(json.dumps({"r": rows, "L": mix}, separators=(",", ":")))
print(json.dumps(mix))
