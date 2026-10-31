#!/usr/bin/env python3
"""Spillernes virkelige karriere før spilstart (public/data/careers.json).

Læser appearances fra transfermarkt-datasets (CC0) og summerer kampe, mål, assists og minutter
pr. spiller, sæson og klub for spillerne i world.json. Filen hentes først, når man åbner en
spillerprofil, så den gør hverken spillet eller de gemte spil større.

Klubskifter (med transfersum, hvis den er kendt) kommer fra transfers.csv.gz.

Kør: python3 scripts/build-careers.py   (forudsætter data-src/appearances.csv.gz, clubs.csv.gz og transfers.csv.gz)
Bemærk: datasættet dækker de ligaer og turneringer Transfermarkt-datasættet indeholder –
ophold i mindre ligaer kan mangle.
"""
import collections
import csv
import gzip
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")
WORLD = os.path.join(ROOT, "public", "data", "world.json")
OUT = os.path.join(ROOT, "public", "data", "careers.json")
FIRST_SEASON = 2012
LAST_SEASON = 2024  # 2025/26 er spillets første sæson og tælles i spillet


def rows(name):
    with gzip.open(os.path.join(SRC, f"{name}.csv.gz"), "rb") as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def main():
    with open(WORLD, encoding="utf-8") as f:
        world = json.load(f)
    fid = world["playerFields"].index("id")
    wanted = {int(p[fid]) for p in world["players"]}
    game_clubs = {int(c[0]) for c in world["clubs"]}

    # (spiller, sæson, klub) -> [kampe, mål, assists, minutter]
    agg = collections.defaultdict(lambda: [0, 0, 0, 0])
    for a in rows("appearances"):
        pid = to_int(a["player_id"])
        if pid not in wanted:
            continue
        d = a["date"]
        y, m = int(d[:4]), int(d[5:7])
        season = y if m >= 7 else y - 1
        if season < FIRST_SEASON or season > LAST_SEASON:
            continue
        s = agg[(pid, season, to_int(a["player_club_id"]))]
        s[0] += 1
        s[1] += to_int(a["goals"])
        s[2] += to_int(a["assists"])
        s[3] += to_int(a["minutes_played"])

    # navne på klubber der ikke findes i spillet
    names = {to_int(c["club_id"]): c["name"] for c in rows("clubs")}
    hist_clubs = {}
    careers = collections.defaultdict(list)
    for (pid, season, club), (apps, goals, assists, minutes) in sorted(agg.items()):
        if apps == 0:
            continue
        if club not in game_clubs:
            hist_clubs[club] = names.get(club, "?")
        # fladt format: sæson-offset, klub, kampe, mål, assists, minutter
        careers[pid] += [season - FIRST_SEASON, club, apps, goals, assists, minutes]

    # klubskifter før spilstart: sæson-offset, fra-klub, til-klub, transfersum i tusinder (-1 = ukendt)
    moves = collections.defaultdict(list)
    for t in rows("transfers"):
        pid = to_int(t["player_id"])
        if pid not in wanted:
            continue
        d = t["transfer_date"]
        if not d or d >= "2025-07-01":
            continue
        y, m = int(d[:4]), int(d[5:7])
        season = y if m >= 7 else y - 1
        if season < FIRST_SEASON:
            continue
        fc, tc = to_int(t["from_club_id"]), to_int(t["to_club_id"])
        if fc == tc:
            continue
        fee = -1 if t["transfer_fee"] == "" else round(float(t["transfer_fee"]) / 1000)
        for club, name in ((fc, t["from_club_name"]), (tc, t["to_club_name"])):
            if club not in game_clubs and club not in hist_clubs:
                hist_clubs[club] = names.get(club, name or "?")
        moves[pid].append((d, [season - FIRST_SEASON, fc, tc, fee]))

    out = {
        "source": "transfermarkt-datasets (CC0)",
        "first": FIRST_SEASON,
        "fields": ["season", "club", "apps", "goals", "assists", "minutes"],
        "clubs": {str(k): v for k, v in hist_clubs.items()},
        "players": {str(k): v for k, v in careers.items()},
        "moveFields": ["season", "from", "to", "feeThousands (-1 = ukendt)"],
        "moves": {str(k): [x for _, row in sorted(v) for x in row] for k, v in moves.items()},
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(careers)} spillere, {sum(len(v) // 6 for v in careers.values())} sæsonlinjer, {sum(len(v) for v in moves.values())} klubskifter, {len(hist_clubs)} historiske klubber → {OUT}")


if __name__ == "__main__":
    main()
