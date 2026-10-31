#!/usr/bin/env python3
"""Byg public/data/logos.json: klub-id -> sti i luukhopman/football-logos.

Logoerne kopieres IKKE ind i projektet. Spillet henter dem ved kørsel fra jsDelivr
(https://cdn.jsdelivr.net/gh/luukhopman/football-logos@master/<sti>). Kun europæiske
ligaer findes i pakken. Kræver `gh` (GitHub CLI) eller netadgang til api.github.com.
"""
import difflib, json, os, re, subprocess, sys, unicodedata

REPO = "luukhopman/football-logos"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\b(fc|cf|afc|sc|ac|fk|sk|bk|if|club|the|de|calcio|football|futbol|1\.)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def tree():
    out = subprocess.run(["gh", "api", f"repos/{REPO}/git/trees/HEAD?recursive=1", "--jq", ".tree[].path"],
                         capture_output=True, text=True, check=True).stdout
    return [p for p in out.splitlines() if p.endswith(".png")]


def main():
    world = json.load(open("public/data/world.json", encoding="utf-8"))
    paths = tree()
    # Nyeste først: logos/ og derefter history/ i faldende sæson
    def rank(p):
        if p.startswith("logos/"):
            return "9999"
        m = re.search(r"history/(\d{4})", p)
        return m.group(1) if m else "0"
    paths.sort(key=rank, reverse=True)
    by_name = {}
    for p in paths:
        key = norm(os.path.splitext(os.path.basename(p))[0])
        by_name.setdefault(key, p)
    aliases = {"FC København": "FC Copenhagen", "Brøndby IF": "Bröndby IF", "FC Nordsjælland": "FC Nordsjaelland",
               "Sønderjyske Fodbold": "Sönderjyske Fodbold", "Lyngby BK": "Lyngby Boldklub", "OB": "Odense Boldklub", "AGF": "Aarhus GF",
               "FK Dinamo Moskva": "Dynamo Moscow", "PFK CSKA Moskva": "CSKA Moscow", "Lokomotiv Moskva": "Lokomotiv Moscow",
               "Tromsø Idrettslag": "Tromsø IL", "Idrettsklubben Start": "IK Start", "Kalmar Fotbollförening": "Kalmar FF",
               "Malmö Fotbollförening": "Malmö FF", "Vålerengens Idrettsforening": "Vålerenga Fotball"}
    # Logoer pr. land (mappenavne er "Land - Liga")
    by_country = {}
    for p in paths:
        m = re.search(r"/([^/]+?) - [^/]+/[^/]+$", p)
        if m:
            by_country.setdefault(m.group(1), {}).setdefault(norm(os.path.splitext(os.path.basename(p))[0]), p)
    nations = world["nations"]
    out, missing = {}, []
    for cid, name, short, nation, *_ in world["clubs"]:
        cands = [name, short, aliases.get(name, ""), aliases.get(short, "")]
        hit = next((by_name[norm(c)] for c in cands if c and norm(c) in by_name), None)
        if not hit:
            pool = by_country.get(nations[nation]["name"], {})
            best, score = None, 0.0
            for c in filter(None, cands):
                n = norm(c)
                if len(n) < 3:
                    continue
                for key, path in pool.items():
                    r = difflib.SequenceMatcher(None, n, key).ratio()
                    # delstreng (fx "malmo" i "malmofotbollforening") tæller som stærkt match
                    if len(key) >= 4 and (key in n or n in key):
                        r = max(r, 0.85)
                    if r > score:
                        best, score = path, r
            if score >= 0.72:
                hit = best
        if hit:
            out[cid] = hit
        else:
            missing.append(name)
    with open("public/data/logos.json", "w", encoding="utf-8") as f:
        json.dump({"base": f"https://cdn.jsdelivr.net/gh/{REPO}@master/", "logos": out}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} klubber med logo, {len(missing)} uden", file=sys.stderr)


if __name__ == "__main__":
    main()
