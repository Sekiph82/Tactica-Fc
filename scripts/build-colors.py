#!/usr/bin/env python3
"""Klubbernes officielle farver (public/data/clubcolors.json) fra Wikidata (CC0).

Henter "officiel farve" (P6364) med hex-kode (P465) for alle klubber med et Transfermarkt-ID (P7223)
og gemmer dem for klubberne i world.json. Spillet bruger dem til klubtemaet; logoet giver den præcise nuance.

Kør: python3 scripts/build-colors.py
"""
import json
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLD = os.path.join(ROOT, "public", "data", "world.json")
OUT = os.path.join(ROOT, "public", "data", "clubcolors.json")
QUERY = """SELECT ?tm ?hex WHERE {
  ?club wdt:P7223 ?tm . ?club p:P6364 ?st . ?st ps:P6364 ?col . ?col wdt:P465 ?hex .
}"""


def main():
    with open(WORLD, encoding="utf-8") as f:
        clubs = {str(c[0]) for c in json.load(f)["clubs"]}
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": QUERY})
    req = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": "cm0102-reborn-colors/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.load(r)["results"]["bindings"]
    out = {}
    for row in rows:
        tm, hx = row["tm"]["value"], row["hex"]["value"].upper().lstrip("#")
        if tm in clubs and len(hx) == 6 and hx not in out.setdefault(tm, []):
            out[tm].append(hx)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "Wikidata (CC0)", "colors": out}, f, separators=(",", ":"))
    print(f"{len(out)} klubber med farver → {OUT}")


if __name__ == "__main__":
    main()
