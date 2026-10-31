#!/usr/bin/env python3
"""Byg spillets verdensdata fra transfermarkt-datasets (CC0).

Brug:
    python3 scripts/build-data.py [--src DIR] [--download]

Henter (med --download) CSV-filerne fra transfermarkt-datasets' offentlige R2-bucket
og skriver public/data/world.json. Attributter (1-20) beregnes IKKE her, men
deterministisk i spillet (src/game/data/attributes.ts), så samme generator
også bruges til regens og fyld-spillere.
"""
import argparse
import collections
import csv
import gzip
import json
import os
import re
import sys
import urllib.request

BASE_URL = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/"
TABLES = ["players", "clubs", "competitions", "games", "appearances"]
SEASON = "2025"
STATS_FROM = "2024-07-01"  # mål/assists/minutter tælles fra denne dato

# Navne på ligaer (pæne visningsnavne)
LEAGUE_NAMES = {
    "GB1": "Premier League", "GB2": "Championship",
    "DK1": "Superligaen", "DK2": "NordicBet Liga",
    "ES1": "LaLiga", "ES2": "LaLiga 2",
    "IT1": "Serie A", "IT2": "Serie B",
    "L1": "Bundesliga", "L2": "2. Bundesliga",
    "FR1": "Ligue 1", "FR2": "Ligue 2",
    "NL1": "Eredivisie", "PO1": "Liga Portugal", "BE1": "Jupiler Pro League",
    "SC1": "Scottish Premiership", "TR1": "Süper Lig", "A1": "Österreichische Bundesliga",
    "C1": "Super League", "GR1": "Super League 1", "NO1": "Eliteserien",
    "SE1": "Allsvenskan", "PL1": "Ekstraklasa", "TS1": "Chance Liga", "KR1": "SuperSport HNL",
    "RO1": "SuperLiga", "SER1": "Super liga Srbije", "UKR1": "Premier Liha", "RU1": "Premier Liga",
    "ARG1": "Liga Profesional", "BRA1": "Brasileirão Série A", "MEX1": "Liga MX",
    "MLS1": "Major League Soccer", "JAP1": "J1 League", "RSK1": "K League 1",
    "AUS1": "A-League Men", "SA1": "Saudi Pro League", "COL1": "Liga BetPlay",
}
LEAGUE_NATION = {"COL1": "Colombia", "GB2": "England", "DK2": "Denmark", "ES2": "Spain",
                 "IT2": "Italy", "L2": "Germany", "FR2": "France"}

# 2. divisioner 2025/26. (navn, transfermarkt-id eller None)
SECOND_TIERS = {
    "GB2": [("Birmingham City", 337), ("Blackburn Rovers", 164), ("Bristol City", 698), ("Charlton Athletic", 358),
            ("Coventry City", 990), ("Derby County", 22), ("Hull City", 3008), ("Ipswich Town", 677),
            ("Leicester City", 1003), ("Middlesbrough", 641), ("Millwall", 1028), ("Norwich City", 1123),
            ("Oxford United", 988), ("Portsmouth", 1020), ("Preston North End", 466), ("Queens Park Rangers", 1039),
            ("Sheffield United", 350), ("Sheffield Wednesday", 1035), ("Southampton", 180), ("Stoke City", 512),
            ("Swansea City", 2288), ("Watford", 1010), ("West Bromwich Albion", 984), ("Wrexham", 1112)],
    "DK2": [("AaB", 1053), ("Lyngby BK", 369), ("Hvidovre IF", 1894), ("Kolding IF", 12275), ("HB Køge", None),
            ("Hillerød Fodbold", None), ("B.93", None), ("AC Horsens", 2414), ("Esbjerg fB", 3426),
            ("Hobro IK", 5818), ("Middelfart BK", 5767), ("Aarhus Fremad", 5784)],
    "L2": [("Arminia Bielefeld", 10), ("SV Darmstadt 98", 105), ("Dynamo Dresden", 129), ("Eintracht Braunschweig", 23),
           ("SV Elversberg", 64), ("Fortuna Düsseldorf", 38), ("Greuther Fürth", 65), ("Hannover 96", 42),
           ("Hertha BSC", 44), ("Holstein Kiel", 269), ("1. FC Kaiserslautern", 2), ("Karlsruher SC", 48),
           ("1. FC Magdeburg", 187), ("1. FC Nürnberg", 4), ("SC Paderborn 07", 127), ("Preußen Münster", 91),
           ("FC Schalke 04", 33), ("VfL Bochum", 80)],
    "IT2": [("Avellino", 2331), ("Bari", 332), ("Carrarese", 4159), ("Catanzaro", 4097), ("Cesena", 1429),
            ("Empoli", 749), ("Virtus Entella", 20519), ("Frosinone", 8970), ("Juve Stabia", 5587), ("Mantova", 2581),
            ("Modena", 1385), ("Monza", 2919), ("Padova", 3037), ("Palermo", 458), ("Pescara", 2921),
            ("Reggiana", 5621), ("Sampdoria", 1038), ("Spezia", 3522), ("Südtirol", 4554), ("Venezia", 607)],
    "ES2": [("Albacete", 1532), ("UD Almería", 3302), ("FC Andorra", 10718), ("Burgos CF", 1536), ("Cádiz CF", 2687),
            ("CD Castellón", 2502), ("AD Ceuta", 8568), ("Córdoba CF", 993), ("Cultural Leonesa", 4542),
            ("Deportivo La Coruña", 897), ("SD Eibar", 1533), ("Granada CF", 16795), ("SD Huesca", 5358),
            ("UD Las Palmas", 472), ("CD Leganés", 1244), ("Málaga CF", 1084), ("CD Mirandés", 13222),
            ("Racing Santander", 630), ("Real Sociedad B", None), ("Real Valladolid", 366), ("Real Zaragoza", 142),
            ("Sporting Gijón", 2448)],
    "FR2": [("Amiens SC", 1416), ("FC Annecy", None), ("SC Bastia", 595), ("US Boulogne", None),
            ("Clermont Foot", 3524), ("USL Dunkerque", None), ("Grenoble Foot", None), ("EA Guingamp", 855),
            ("Stade Lavallois", None), ("Le Mans FC", None), ("Montpellier HSC", 969), ("AS Nancy", 1159),
            ("Pau FC", None), ("Red Star FC", None), ("Stade de Reims", 1421), ("Rodez AF", None),
            ("AS Saint-Étienne", 618), ("ESTAC Troyes", 1095)],
}

STRIP_WORDS = [
    "Football Club", "Futebol Clube", "Fußballclub", "Fotballklubben", "Fotballklubb", "Fotballforening",
    "Soccer Club", "Saudi Football Club", "Associazione Sportiva", "Società Sportiva", "S.p.A.",
    "Spółka Akcyjna", "Klub Sportowy", "Athlitikos Omilos", "Idrottsförening", "Idrottsföreningen",
    "Asociación Atlética", "Asociación Civil", "Asociación", "Club Atlético", "Club Social y Deportivo",
    "Sociedade Esportiva", "Sport Club", "Associação", "Club de", "Sportklub", "Sportclub", "Jimnastik Kulübü",
    "Futebol e Regatas", "Clube de Regatas do", "Club de Regatas", "Esporte Clube", "Esporte", "Futebol",
    "Clube", "Foot Ball", "Football", "Club",
]
SHORT_OVERRIDES = {
    "Sociedade Esportiva Palmeiras": "Palmeiras", "Bologna Football Club 1909": "Bologna",
    "Associazione Sportiva Roma": "AS Roma", "Società Sportiva Lazio S.p.A.": "Lazio",
    "Beşiktaş Jimnastik Kulübü": "Beşiktaş", "Al-Hilal Saudi Football Club": "Al-Hilal",
    "Al-Ahli Saudi Football Club": "Al-Ahli", "Club Atlético Boca Juniors": "Boca Juniors",
    "Club Atlético River Plate": "River Plate", "Sport Club Corinthians Paulista": "Corinthians",
    "Grêmio Foot-Ball Porto Alegrense": "Grêmio", "Fluminense Football Club": "Fluminense",
    "Fußballclub Red Bull Salzburg": "RB Salzburg", "Sportklub Puntigamer Sturm Graz": "Sturm Graz",
    "Fotballklubben Bodø/Glimt": "Bodø/Glimt", "Allmänna Idrottsklubben": "AIK",
    "Djurgårdens Idrottsförening": "Djurgården", "Idrottsföreningen Elfsborg": "Elfsborg",
    "Idrottsföreningen  Brommapojkarna": "Brommapojkarna", "Mjällby Almänna Idrottsförening": "Mjällby AIF",
    "Panathinaikos Athlitikos Omilos": "Panathinaikos", "Royal Charleroi Sporting Club": "Charleroi",
    "Borussia Mönchengladbach": "Gladbach", "1. Fußballclub Heidenheim 1846": "Heidenheim",
    "Wolverhampton Wanderers": "Wolves", "Brighton & Hove Albion": "Brighton", "Manchester United": "Man Utd",
    "Manchester City": "Man City", "Tottenham Hotspur": "Tottenham", "Nottingham Forest": "Nott'm Forest",
    "Newcastle United": "Newcastle", "West Ham United": "West Ham", "Western Sydney Wanderers": "WS Wanderers",
    "New York City Football Club": "New York City", "Los Angeles Football Club": "LAFC",
    "Grasshopper Club Zurich": "Grasshoppers", "Fortuna Sittardia Combinatie": "Fortuna Sittard",
    "Racing Club Asociación Civil de Avellaneda": "Racing Club", "Club Atlético San Lorenzo de Almagro": "San Lorenzo",
    "Club Atlético Independiente de Avellaneda": "Independiente", "Club Atlético Vélez Sársfield": "Vélez Sarsfield",
    "Club Atlético Newell’s Old Boys": "Newell's", "Club Atlético Rosario Central": "Rosario Central",
    "Asociación Atlética Argentinos Juniors": "Argentinos Jrs", "Club Estudiantes de La Plata": "Estudiantes",
    "Panthessalonikios Athlitikos Omilos Konstantinoupoliton": "PAOK", "Athlitiki Enosi Konstantinoupoleos": "AEK Athen",
    "Olympiacos Syndesmos Filathlon Peiraios": "Olympiacos", "Football Club Pohang Steelers": "Pohang Steelers",
    "Ulsan Hyundai Football Club": "Ulsan HD", "Termalica Bruk-Bet Nieciecza Klub Sportowy": "Termalica",
    "Club de Gimnasia y Esgrima La Plata": "Gimnasia LP", "FC Copenhagen": "FC København",
    "Bröndby IF": "Brøndby IF", "Sönderjyske Fodbold": "Sønderjyske", "FC Nordsjaelland": "FC Nordsjælland",
    "Odense Boldklub": "OB", "Aarhus GF": "AGF", "Associação Chapecoense de Futebol": "Chapecoense",
    "Paris Saint-Germain Football Club": "PSG", "Olympique de Marseille": "Marseille",
    "Olympique Lyonnais": "Lyon", "Asociación Deportivo Pasto": "Deportivo Pasto", "Club Brugge KV": "Club Brugge",
    "Clube Atlético Mineiro": "Atlético Mineiro", "Cruzeiro Esporte Clube": "Cruzeiro",
    "Club de Regatas Vasco da Gama": "Vasco da Gama", "Clube de Regatas do Flamengo": "Flamengo",
    "Botafogo de Futebol e Regatas": "Botafogo", "Club Atlético de Madrid": "Atlético Madrid",
    "Real Madrid Club de Fútbol": "Real Madrid", "Heart of Midlothian FC": "Hearts",
    "TOV FK Metalist 1925 Kharkiv": "Metalist 1925", "AO FK Zenit Sankt-Peterburg": "Zenit",
    'Футбольный клуб "Локомотив" Москва': "Lokomotiv Moskva", "Olympiakos Syndesmos Filathlon Peiraios": "Olympiakos",
    "Göteborgs Atlet- och Idrottssällskap": "GAIS", "Foundation Coorperation Hana Financial Group Inc. Football Club": "Daejeon Hana",
    "Morski Związkowy Klub Sportowy Arka Gdynia Spółka Akcyjna": "Arka Gdynia", "Internacional de Bogotá": "Inter Bogotá",
    "Club Internacional de Fútbol Miami": "Inter Miami", "Independiente Santa Fe": "Santa Fe",
    "Club Atlético Gimnasia y Esgrima de Mendoza": "Gimnasia Mendoza", "Volou Neos Podosferikos Syllogos": "Volos NPS",
    "Athlitiki Enosi Kifisias": "Kifisia", "Athlitiki Enosi Larisas": "AEL Larissa", "Omilos Filathlon Irakliou FC": "OFI Kreta",
    "A.G.S Asteras Tripolis": "Asteras Tripolis", "PFK Krylya Sovetov Samara": "Krylya Sovetov",
    "Asociación de Fomento Deportivo Riestra Barrio Colón": "Dep. Riestra", "Club Sportivo Independiente Rivadavia": "Ind. Rivadavia",
    "Hitachi Kashiwa Reysol": "Kashiwa Reysol", "FK Csikszereda Miercurea Ciuc": "Csikszereda", "Västerås Sportklubb FK": "Västerås SK",
    "Al-Qadsiah Saudi Football Club": "Al-Qadsiah", "Al-Riyadh Saudi Club": "Al-Riyadh", "FC Universitatea Cluj": "U Cluj",
    "SK Sigma Olomouc, a.s.": "Sigma Olomouc", "FC Baník Ostrava a.s.": "Baník Ostrava", "Club de Foot Montréal": "CF Montréal",
    "Newcastle United Jets": "Newcastle Jets", "FC Dinamo 1948": "Dinamo Bucureşti", "FC Rapid 1923": "Rapid Bucureşti",
    "Gençlerbirliği Spor Kulübü": "Gençlerbirliği", "Instituto Atlético Central Córdoba": "Instituto",
    "AFC Unirea 04 Slobozia": "Unirea Slobozia", "FK Radnicki 1923 Kragujevac": "Radnički 1923", "APS Atromitos Athinon": "Atromitos",
    "FK Vojvodina Novi Sad": "Vojvodina", "FC Metaloglobus Bucharest": "Metaloglobus", "Idrottsföreningen Kamraterna Göteborg": "IFK Göteborg",
    "FK Javor-Matis Ivanjica": "Javor Ivanjica", "FK Zeleznicar Pancevo": "Železničar Pančevo", "Sportclub Rheindorf Altach": "Altach",
    "Pisa Sporting Club": "Pisa", "Parma Calcio 1913": "Parma", "Neom Sports Club": "Neom SC", "Futbol Club Barcelona": "Barcelona",
}

NAME_FIX = {
    "FC Copenhagen": "FC København", "Bröndby IF": "Brøndby IF", "FC Nordsjaelland": "FC Nordsjælland",
    "Sönderjyske Fodbold": "Sønderjyske Fodbold", "FC Helsingör": "FC Helsingør",
}

NATION_CODES = {
    "England": "ENG", "Denmark": "DEN", "Germany": "GER", "Spain": "ESP", "Italy": "ITA", "France": "FRA",
    "Netherlands": "NED", "Portugal": "POR", "Belgium": "BEL", "Scotland": "SCO", "Wales": "WAL",
    "Northern Ireland": "NIR", "Ireland": "IRL", "Switzerland": "SUI", "Austria": "AUT", "Sweden": "SWE",
    "Norway": "NOR", "Finland": "FIN", "Iceland": "ISL", "Poland": "POL", "Czech Republic": "CZE",
    "Croatia": "CRO", "Serbia": "SRB", "Greece": "GRE", "Türkiye": "TUR", "Romania": "ROU", "Ukraine": "UKR",
    "Russia": "RUS", "Brazil": "BRA", "Argentina": "ARG", "Uruguay": "URU", "Colombia": "COL", "Chile": "CHI",
    "Mexico": "MEX", "United States": "USA", "Canada": "CAN", "Japan": "JPN", "Korea, South": "KOR",
    "Australia": "AUS", "Saudi Arabia": "KSA", "Nigeria": "NGA", "Ghana": "GHA", "Senegal": "SEN",
    "Cote d'Ivoire": "CIV", "Cameroon": "CMR", "Morocco": "MAR", "Algeria": "ALG", "Tunisia": "TUN",
    "Egypt": "EGY", "Mali": "MLI", "Slovenia": "SVN", "Slovakia": "SVK", "Hungary": "HUN", "Bulgaria": "BUL",
    "Bosnia-Herzegovina": "BIH", "North Macedonia": "MKD", "Montenegro": "MNE", "Albania": "ALB",
    "Kosovo": "KVX", "Georgia": "GEO", "Armenia": "ARM", "Paraguay": "PAR", "Ecuador": "ECU", "Peru": "PER",
    "Venezuela": "VEN", "Bolivia": "BOL", "Jamaica": "JAM", "Israel": "ISR", "Cyprus": "CYP",
}

SUBPOS = {
    "Goalkeeper": "GK", "Centre-Back": "CB", "Left-Back": "LB", "Right-Back": "RB",
    "Defensive Midfield": "DM", "Central Midfield": "CM", "Attacking Midfield": "AM",
    "Left Midfield": "LM", "Right Midfield": "RM", "Left Winger": "LW", "Right Winger": "RW",
    "Centre-Forward": "CF", "Second Striker": "SS",
}
POS_FALLBACK = {"Goalkeeper": "GK", "Defender": "CB", "Midfield": "CM", "Attack": "CF"}


def short_name(name: str) -> str:
    name = name.strip()
    if name in SHORT_OVERRIDES:
        return SHORT_OVERRIDES[name]
    s = name
    for w in STRIP_WORDS:
        s = re.sub(r"(?<!\w)" + re.escape(w) + r"(?!\w)", " ", s)
    s = re.sub(r"^((de|do|da|e|y)\s+)+|(\s+(de|do|da|e|y))+$", "", s.strip())
    s = re.sub(r"\b(18|19|20)\d\d\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -")
    if len(s) > 20:
        s = " ".join(s.split()[:2])
    return s or name[:20]


def download(src):
    os.makedirs(src, exist_ok=True)
    for t in TABLES:
        path = os.path.join(src, t + ".csv")
        if os.path.exists(path):
            continue
        print("henter", t, file=sys.stderr)
        with urllib.request.urlopen(BASE_URL + t + ".csv.gz") as r:
            data = gzip.decompress(r.read())
        with open(path, "wb") as f:
            f.write(data)


def rows(src, t):
    with open(os.path.join(src, t + ".csv"), newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def to_int(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data-src")
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--out", default="public/data/world.json")
    a = ap.parse_args()
    if a.download:
        download(a.src)

    comps = {c["competition_id"]: c for c in rows(a.src, "competitions")}
    clubs_raw = {c["club_id"]: c for c in rows(a.src, "clubs")}
    players_raw = list(rows(a.src, "players"))

    # Kamp-statistik siden STATS_FROM
    stats = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0])  # apps, min, g, a, y, r
    for ap_ in rows(a.src, "appearances"):
        if ap_["date"] < STATS_FROM:
            continue
        s = stats[ap_["player_id"]]
        s[0] += 1
        s[1] += to_int(ap_["minutes_played"])
        s[2] += to_int(ap_["goals"])
        s[3] += to_int(ap_["assists"])
        s[4] += to_int(ap_["yellow_cards"])
        s[5] += to_int(ap_["red_cards"])

    nations = []
    nation_idx = {}

    def nat(name):
        name = (name or "").strip() or "Unknown"
        if name not in nation_idx:
            nation_idx[name] = len(nations)
            nations.append({"name": name, "code": NATION_CODES.get(name, re.sub(r"[^A-Z]", "", name.upper())[:3])})
        return nation_idx[name]

    # Ligaer: alle førstedivisioner med klubber i SEASON
    leagues = {}
    clubs = {}
    for cid, c in clubs_raw.items():
        if c["last_season"] != SEASON:
            continue
        comp = c["domestic_competition_id"]
        if comp not in leagues:
            country = comps.get(comp, {}).get("country_name") or LEAGUE_NATION.get(comp, "Unknown")
            leagues[comp] = {"id": comp, "name": LEAGUE_NAMES.get(comp, comp), "nation": nat(country), "tier": 1}
        clubs[cid] = {
            "id": int(cid), "name": NAME_FIX.get(c["name"].strip(), c["name"].strip()), "short": short_name(c["name"]),
            "nation": leagues[comp]["nation"], "league": comp,
            "stadium": c["stadium_name"], "seats": to_int(c["stadium_seats"], 5000),
            "coach": c["coach_name"] or "",
        }

    # 2. divisioner
    fake_id = 9_000_000
    for comp, lst in SECOND_TIERS.items():
        nidx = nat(LEAGUE_NATION[comp])
        leagues[comp] = {"id": comp, "name": LEAGUE_NAMES[comp], "nation": nidx, "tier": 2}
        for name, tmid in lst:
            raw = clubs_raw.get(str(tmid)) if tmid else None
            if tmid is None:
                fake_id += 1
                cid = str(fake_id)
            else:
                cid = str(tmid)
            clubs[cid] = {
                "id": int(cid), "name": name, "short": short_name(name), "nation": nidx, "league": comp,
                "stadium": raw["stadium_name"] if raw else "", "seats": to_int(raw["stadium_seats"], 0) if raw else 0,
                "coach": "",
            }

    # Spillere
    out_players = []
    unattached = collections.defaultdict(list)
    name_pool = collections.defaultdict(lambda: (collections.Counter(), collections.Counter()))
    for p in players_raw:
        n = nat(p["country_of_citizenship"] or p["country_of_birth"])
        fn, ln = (p["first_name"] or "").strip(), (p["last_name"] or "").strip()
        if fn:
            name_pool[n][0][fn] += 1
        if ln:
            name_pool[n][1][ln] += 1
        season = p["last_season"]
        cid = p["current_club_id"]
        in_club = cid in clubs and (season == SEASON or (clubs[cid]["league"] in SECOND_TIERS and season >= "2023"))
        if not in_club and season != SEASON:
            continue
        if not p["date_of_birth"]:
            continue
        s = stats.get(p["player_id"], [0] * 6)
        pos = SUBPOS.get(p["sub_position"]) or POS_FALLBACK.get(p["position"], "CM")
        foot = {"right": "R", "left": "L", "both": "B"}.get(p["foot"], "")
        cexp = (p["contract_expiration_date"] or "")[:10]
        rec = [
            int(p["player_id"]), fn, ln or p["name"], p["date_of_birth"][:10], n,
            int(cid) if in_club else 0, pos, foot, to_int(p["height_in_cm"]),
            to_int(p["market_value_in_eur"]), to_int(p["highest_market_value_in_eur"]),
            to_int(p["international_caps"]), to_int(p["international_goals"]), cexp,
        ] + s
        if in_club:
            out_players.append(rec)
        else:
            unattached[n].append(rec)

    # Klubløse (ofte landsholdsspillere fra ligaer uden for datasættet) bliver fri agenter
    for lst in unattached.values():
        for r in lst:
            if r[9] >= 500_000:
                out_players.append(r)

    names = {}
    for n, (fc, lc) in name_pool.items():
        if sum(lc.values()) < 15:
            continue
        names[n] = [[k for k, _ in fc.most_common(250)], [k for k, _ in lc.most_common(400)]]

    out = {
        "version": 1,
        "source": "transfermarkt-datasets (CC0) – github.com/dcaribou/transfermarkt-datasets",
        "season": int(SEASON),
        "nations": nations,
        "leagues": sorted(leagues.values(), key=lambda l: (nations[l["nation"]]["name"], l["tier"])),
        "clubs": [[c["id"], c["name"], c["short"], c["nation"], c["league"], c["stadium"], c["seats"], c["coach"]]
                  for c in clubs.values()],
        "playerFields": ["id", "first", "last", "dob", "nation", "club", "pos", "foot", "height", "value",
                         "maxValue", "caps", "intGoals", "contract", "apps", "minutes", "goals", "assists",
                         "yellows", "reds"],
        "players": out_players,
        "names": names,
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(leagues)} ligaer, {len(clubs)} klubber, {len(out_players)} spillere, "
          f"{len(nations)} nationer -> {a.out} ({os.path.getsize(a.out)//1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
