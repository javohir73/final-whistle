"""Explicit club identity map for the UCL rating-scale experiment.

Canonical key: ``"CTY:<name>"``. For the twelve countries with a domestic
feed the name is football-data.co.uk's spelling (so the UCL and domestic
streams share one key); for every other country it is openfootball's
spelling. Nothing here is fuzzy: every alias is written out, and anything not
listed falls through to ``"CTY:<raw>"`` and is reported by ``audit()``.
"""
from __future__ import annotations

# openfootball UCL spelling -> canonical (covered countries + spelling variants)
UCL_ALIASES: dict[tuple[str, str], str] = {
    # ENG
    ("Arsenal FC", "ENG"): "ENG:Arsenal", ("Aston Villa FC", "ENG"): "ENG:Aston Villa",
    ("Chelsea FC", "ENG"): "ENG:Chelsea", ("Leicester City", "ENG"): "ENG:Leicester",
    ("Liverpool FC", "ENG"): "ENG:Liverpool", ("Manchester City", "ENG"): "ENG:Man City",
    ("Manchester City FC", "ENG"): "ENG:Man City", ("Manchester United", "ENG"): "ENG:Man United",
    ("Manchester United FC", "ENG"): "ENG:Man United",
    ("Newcastle United FC", "ENG"): "ENG:Newcastle", ("Tottenham Hotspur", "ENG"): "ENG:Tottenham",
    ("Tottenham Hotspur FC", "ENG"): "ENG:Tottenham",
    # ESP
    ("Athletic Club", "ESP"): "ESP:Ath Bilbao", ("Atlético Madrid", "ESP"): "ESP:Ath Madrid",
    ("Club Atlético de Madrid", "ESP"): "ESP:Ath Madrid", ("FC Barcelona", "ESP"): "ESP:Barcelona",
    ("Girona FC", "ESP"): "ESP:Girona", ("Málaga CF", "ESP"): "ESP:Malaga",
    ("Real Madrid", "ESP"): "ESP:Real Madrid", ("Real Madrid CF", "ESP"): "ESP:Real Madrid",
    ("Real Sociedad", "ESP"): "ESP:Sociedad", ("Real Sociedad de Fútbol", "ESP"): "ESP:Sociedad",
    ("Sevilla FC", "ESP"): "ESP:Sevilla", ("Valencia CF", "ESP"): "ESP:Valencia",
    ("Villarreal CF", "ESP"): "ESP:Villarreal",
    # GER
    ("1. FC Union Berlin", "GER"): "GER:Union Berlin", ("1899 Hoffenheim", "GER"): "GER:Hoffenheim",
    ("Bayer 04 Leverkusen", "GER"): "GER:Leverkusen", ("Bayer Leverkusen", "GER"): "GER:Leverkusen",
    ("Bayern München", "GER"): "GER:Bayern Munich", ("FC Bayern München", "GER"): "GER:Bayern Munich",
    ("Bor. Mönchengladbach", "GER"): "GER:M'gladbach", ("Borussia Dortmund", "GER"): "GER:Dortmund",
    ("Eintracht Frankfurt", "GER"): "GER:Ein Frankfurt", ("FC Schalke 04", "GER"): "GER:Schalke 04",
    ("RB Leipzig", "GER"): "GER:RB Leipzig", ("VfB Stuttgart", "GER"): "GER:Stuttgart",
    ("VfL Wolfsburg", "GER"): "GER:Wolfsburg",
    # ITA
    ("AC Milan", "ITA"): "ITA:Milan", ("AS Roma", "ITA"): "ITA:Roma", ("Atalanta", "ITA"): "ITA:Atalanta",
    ("Atalanta BC", "ITA"): "ITA:Atalanta", ("Bologna FC 1909", "ITA"): "ITA:Bologna",
    ("FC Internazionale Milano", "ITA"): "ITA:Inter", ("Inter", "ITA"): "ITA:Inter",
    ("Juventus", "ITA"): "ITA:Juventus", ("Juventus FC", "ITA"): "ITA:Juventus",
    ("Lazio Roma", "ITA"): "ITA:Lazio", ("SS Lazio", "ITA"): "ITA:Lazio", ("SSC Napoli", "ITA"): "ITA:Napoli",
    # FRA (+ Monaco, which plays in Ligue 1)
    ("AS Monaco", "FRA"): "FRA:Monaco", ("AS Monaco FC", "MCO"): "FRA:Monaco",
    ("Lille OSC", "FRA"): "FRA:Lille", ("Montpellier HSC", "FRA"): "FRA:Montpellier",
    ("OGC Nice", "FRA"): "FRA:Nice", ("Olympique Lyonnais", "FRA"): "FRA:Lyon",
    ("Olympique Marseille", "FRA"): "FRA:Marseille", ("Olympique de Marseille", "FRA"): "FRA:Marseille",
    ("Paris Saint-Germain", "FRA"): "FRA:Paris SG", ("Paris Saint-Germain FC", "FRA"): "FRA:Paris SG",
    ("Racing Club de Lens", "FRA"): "FRA:Lens", ("Stade Brestois 29", "FRA"): "FRA:Brest",
    ("Stade Rennais", "FRA"): "FRA:Rennes",
    # NED
    ("AFC Ajax", "NED"): "NED:Ajax", ("FC Twente", "NED"): "NED:Twente", ("Feyenoord", "NED"): "NED:Feyenoord",
    ("Feyenoord Rotterdam", "NED"): "NED:Feyenoord", ("PSV", "NED"): "NED:PSV Eindhoven",
    ("PSV Eindhoven", "NED"): "NED:PSV Eindhoven",
    # POR
    ("FC Porto", "POR"): "POR:Porto", ("SL Benfica", "POR"): "POR:Benfica",
    ("Sport Lisboa e Benfica", "POR"): "POR:Benfica", ("Sporting Braga", "POR"): "POR:Sp Braga",
    ("Sporting Clube de Braga", "POR"): "POR:Sp Braga", ("Sporting CP", "POR"): "POR:Sp Lisbon",
    ("Sporting Clube de Portugal", "POR"): "POR:Sp Lisbon",
    # TUR
    ("Beşiktaş", "TUR"): "TUR:Besiktas", ("Fenerbahçe", "TUR"): "TUR:Fenerbahce",
    ("Galatasaray", "TUR"): "TUR:Galatasaray", ("Galatasaray SK", "TUR"): "TUR:Galatasaray",
    ("Trabzonspor", "TUR"): "TUR:Trabzonspor", ("İstanbul Başakşehir", "TUR"): "TUR:Buyuksehyr",
    # BEL
    ("Club Brugge KV", "BEL"): "BEL:Club Brugge", ("KAA Gent", "BEL"): "BEL:Gent",
    ("KRC Genk", "BEL"): "BEL:Genk", ("RSC Anderlecht", "BEL"): "BEL:Anderlecht",
    ("Royal Antwerp FC", "BEL"): "BEL:Antwerp",
    ("Royale Union Saint-Gilloise", "BEL"): "BEL:St. Gilloise",
    ("Union Saint-Gilloise", "BEL"): "BEL:St. Gilloise",
    # SCO
    ("Celtic FC", "SCO"): "SCO:Celtic", ("Rangers FC", "SCO"): "SCO:Rangers",
    # GRE
    ("AEK Athen", "GRE"): "GRE:AEK", ("Olympiakos Piraeus", "GRE"): "GRE:Olympiakos",
    ("PAE Olympiakos SFP", "GRE"): "GRE:Olympiakos", ("PAOK Saloniki", "GRE"): "GRE:PAOK",
    ("Panathinaikos", "GRE"): "GRE:Panathinaikos",
    # AUT
    ("Austria Wien", "AUT"): "AUT:Austria Vienna", ("FC Red Bull Salzburg", "AUT"): "AUT:Salzburg",
    ("RB Salzburg", "AUT"): "AUT:Salzburg", ("SK Sturm Graz", "AUT"): "AUT:Sturm Graz",
    ("Sturm Graz", "AUT"): "AUT:Sturm Graz",
    # spelling variants, countries without a feed
    ("Qarabağ Ağdam FK", "AZE"): "AZE:Qarabağ FK", ("GNK Dinamo Zagreb", "CRO"): "CRO:Dinamo Zagreb",
    ("Paphos FC", "CYP"): "CYP:Pafos FC", ("SK Slavia Praha", "CZE"): "CZE:Slavia Praha",
    ("FK Crvena Zvezda", "SRB"): "SRB:Crvena Zvezda", ("ŠK Slovan Bratislava", "SVK"): "SVK:Slovan Bratislava",
    ("FK Shakhtar Donetsk", "UKR"): "UKR:Shakhtar Donetsk", ("FC Steaua Bucureşti", "ROU"): "ROU:FCSB",
}

# API-Football spelling in the served 2026-27 payload -> canonical
SERVED_ALIASES: dict[str, str] = {
    "AEK Athens FC": "GRE:AEK", "PAE AEK": "GRE:AEK", "AS Roma": "ITA:Roma", "Aarhus": "DEN:Aarhus",
    "Ararat-Armenia": "ARM:Ararat-Armenia", "Arsenal": "ENG:Arsenal", "Aston Villa": "ENG:Aston Villa",
    "Atert Bissen": "LUX:Atert Bissen", "Atletico Madrid": "ESP:Ath Madrid", "Barcelona": "ESP:Barcelona",
    "Bayern München": "GER:Bayern Munich", "Bodo/Glimt": "NOR:FK Bodø/Glimt",
    "Borac Banja Luka": "BIH:Borac Banja Luka", "Borussia Dortmund": "GER:Dortmund", "Celje": "SVN:NK Celje",
    "Celtic": "SCO:Celtic", "Club Brugge KV": "BEL:Club Brugge", "Como": "ITA:Como",
    "Dinamo Zagreb": "CRO:Dinamo Zagreb", "Drita": "KOS:KF Drita", "Egnatia Rrogozhinë": "ALB:Egnatia Rrogozhine",
    "FC Porto": "POR:Porto", "FC Thun": "SUI:FC Thun", "FK Crvena Zvezda": "SRB:Crvena Zvezda",
    "Fenerbahçe": "TUR:Fenerbahce", "Feyenoord": "NED:Feyenoord", "Flora Tallinn": "EST:FC Flora",
    "Floriana": "MLT:Floriana", "Galatasaray": "TUR:Galatasaray", "Gornik Zabrze": "POL:Gornik Zabrze",
    "Gyori ETO FC": "HUN:Gyori ETO FC", "Hapoel Beer Sheva": "ISR:Hapoel Beer Sheva",
    "Heart Of Midlothian": "SCO:Hearts", "Inter": "ITA:Inter", "Inter Club d'Escaldes": "AND:Inter Club d'Escaldes",
    "KI Klaksvik": "FRO:KÍ Klaksvík", "Kairat Almaty": "KAZ:FK Kairat", "Kauno Žalgiris": "LTU:Kauno Zalgiris",
    "KuPS": "FIN:Kuopion PS", "Larne": "NIR:Larne FC", "Lask Linz": "AUT:LASK", "Lech Poznan": "POL:Lech Poznań",
    "Lens": "FRA:Lens", "Levski Sofia": "BUL:Levski Sofia", "Lille": "FRA:Lille",
    "Lincoln Red Imps FC": "GIB:Lincoln Red Imps", "Liverpool": "ENG:Liverpool", "Lyon": "FRA:Lyon",
    "ML Vitebsk": "BLR:ML Vitebsk", "Manchester City": "ENG:Man City", "Manchester United": "ENG:Man United",
    "Mjallby AIF": "SWE:Mjallby AIF", "NEC Nijmegen": "NED:Nijmegen", "Napoli": "ITA:Napoli",
    "Olympiakos Piraeus": "GRE:Olympiakos", "Omonia Nicosia": "CYP:Omonia Nicosia",
    "PSV Eindhoven": "NED:PSV Eindhoven", "Paris Saint Germain": "FRA:Paris SG", "Petrocub": "MDA:CS Petrocub",
    "RB Leipzig": "GER:RB Leipzig", "Real Betis": "ESP:Betis", "Real Madrid": "ESP:Real Madrid",
    "Riga": "LVA:Riga FC", "Sabah FA": "AZE:Sabah FA", "Saburtalo": "GEO:Saburtalo",
    "Shakhtar Donetsk": "UKR:Shakhtar Donetsk", "Shamrock Rovers": "IRL:Shamrock Rovers",
    "Slavia Praha": "CZE:Slavia Praha", "Slovan Bratislava": "SVK:Slovan Bratislava",
    "Sparta Praha": "CZE:AC Sparta Praha", "Sporting CP": "POR:Sp Lisbon", "Sturm Graz": "AUT:Sturm Graz",
    "Sutjeska": "MNE:Sutjeska", "The New Saints": "WAL:The New Saints", "Tre Fiori": "SMR:Tre Fiori",
    "Union St. Gilloise": "BEL:St. Gilloise", "Universitatea Craiova": "ROU:Universitatea Craiova",
    "Vardar Skopje": "MKD:Vardar Skopje", "VfB Stuttgart": "GER:Stuttgart", "Viking": "NOR:Viking",
    "Vikingur Reykjavik": "ISL:Víkingur Reykjavík", "Villarreal": "ESP:Villarreal",
}

DIV_COUNTRY = {"E0": "ENG", "SP1": "ESP", "D1": "GER", "I1": "ITA", "F1": "FRA", "N1": "NED",
               "P1": "POR", "T1": "TUR", "B1": "BEL", "SC0": "SCO", "G1": "GRE", "AUT": "AUT"}
COVERED = set(DIV_COUNTRY.values())


def ucl_key(raw: str, cty: str) -> str:
    return UCL_ALIASES.get((raw, cty), f"{cty}:{raw}")


def dom_key(raw: str, div: str) -> str:
    return f"{DIV_COUNTRY[div]}:{raw}"


def served_key(raw: str) -> str:
    if raw not in SERVED_ALIASES:
        raise KeyError(f"served club {raw!r} has no explicit mapping")
    return SERVED_ALIASES[raw]


def country(key: str) -> str:
    return key.split(":", 1)[0]
