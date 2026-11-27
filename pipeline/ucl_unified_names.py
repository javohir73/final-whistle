"""Explicit club identity for the UCL unified-Elo shadow (pipeline/ucl_unified_elo.py).

Canonical key: ``"CTY:<name>"``. For the twelve countries with a football-data.co.uk
feed the name is that site's spelling, so a club's domestic and UCL results share
one rating; for every other country it is openfootball's spelling (the spelling the
frozen snapshot was built with). Nothing here is fuzzy: every API-Football spelling
we serve is written out in DB_ALIASES, and a team that is not listed is reported as
UNMAPPED by the runtime step (never guessed) and treated as a no-feed club.

DB_ALIASES is the experiment's SERVED_ALIASES (docs/experiments/2026-11-27-ucl-rating-scale/
names.py), which covers all 36 league-phase clubs and every qualifier of 2026-27.
"""
from __future__ import annotations

DIV_COUNTRY = {"E0": "ENG", "SP1": "ESP", "D1": "GER", "I1": "ITA", "F1": "FRA", "N1": "NED",
               "P1": "POR", "T1": "TUR", "B1": "BEL", "SC0": "SCO", "G1": "GRE", "AUT": "AUT"}
COVERED = frozenset(DIV_COUNTRY.values())

#: API-Football team name (Team.name in the DB) -> canonical key.
DB_ALIASES: dict[str, str] = {
    "AEK Athens FC": "GRE:AEK",
    "AS Roma": "ITA:Roma",
    "Aarhus": "DEN:Aarhus",
    "Ararat-Armenia": "ARM:Ararat-Armenia",
    "Arsenal": "ENG:Arsenal",
    "Aston Villa": "ENG:Aston Villa",
    "Atert Bissen": "LUX:Atert Bissen",
    "Atletico Madrid": "ESP:Ath Madrid",
    "Barcelona": "ESP:Barcelona",
    "Bayern München": "GER:Bayern Munich",
    "Bodo/Glimt": "NOR:FK Bodø/Glimt",
    "Borac Banja Luka": "BIH:Borac Banja Luka",
    "Borussia Dortmund": "GER:Dortmund",
    "Celje": "SVN:NK Celje",
    "Celtic": "SCO:Celtic",
    "Club Brugge KV": "BEL:Club Brugge",
    "Como": "ITA:Como",
    "Dinamo Zagreb": "CRO:Dinamo Zagreb",
    "Drita": "KOS:KF Drita",
    "Egnatia Rrogozhinë": "ALB:Egnatia Rrogozhine",
    "FC Porto": "POR:Porto",
    "FC Thun": "SUI:FC Thun",
    "FK Crvena Zvezda": "SRB:Crvena Zvezda",
    "Fenerbahçe": "TUR:Fenerbahce",
    "Feyenoord": "NED:Feyenoord",
    "Flora Tallinn": "EST:FC Flora",
    "Floriana": "MLT:Floriana",
    "Galatasaray": "TUR:Galatasaray",
    "Gornik Zabrze": "POL:Gornik Zabrze",
    "Gyori ETO FC": "HUN:Gyori ETO FC",
    "Hapoel Beer Sheva": "ISR:Hapoel Beer Sheva",
    "Heart Of Midlothian": "SCO:Hearts",
    "Inter": "ITA:Inter",
    "Inter Club d'Escaldes": "AND:Inter Club d'Escaldes",
    "KI Klaksvik": "FRO:KÍ Klaksvík",
    "Kairat Almaty": "KAZ:FK Kairat",
    "Kauno Žalgiris": "LTU:Kauno Zalgiris",
    "KuPS": "FIN:Kuopion PS",
    "Larne": "NIR:Larne FC",
    "Lask Linz": "AUT:LASK",
    "Lech Poznan": "POL:Lech Poznań",
    "Lens": "FRA:Lens",
    "Levski Sofia": "BUL:Levski Sofia",
    "Lille": "FRA:Lille",
    "Lincoln Red Imps FC": "GIB:Lincoln Red Imps",
    "Liverpool": "ENG:Liverpool",
    "Lyon": "FRA:Lyon",
    "ML Vitebsk": "BLR:ML Vitebsk",
    "Manchester City": "ENG:Man City",
    "Manchester United": "ENG:Man United",
    "Mjallby AIF": "SWE:Mjallby AIF",
    "NEC Nijmegen": "NED:Nijmegen",
    "Napoli": "ITA:Napoli",
    "Olympiakos Piraeus": "GRE:Olympiakos",
    "Omonia Nicosia": "CYP:Omonia Nicosia",
    "PAE AEK": "GRE:AEK",
    "PSV Eindhoven": "NED:PSV Eindhoven",
    "Paris Saint Germain": "FRA:Paris SG",
    "Petrocub": "MDA:CS Petrocub",
    "RB Leipzig": "GER:RB Leipzig",
    "Real Betis": "ESP:Betis",
    "Real Madrid": "ESP:Real Madrid",
    "Riga": "LVA:Riga FC",
    "Sabah FA": "AZE:Sabah FA",
    "Saburtalo": "GEO:Saburtalo",
    "Shakhtar Donetsk": "UKR:Shakhtar Donetsk",
    "Shamrock Rovers": "IRL:Shamrock Rovers",
    "Slavia Praha": "CZE:Slavia Praha",
    "Slovan Bratislava": "SVK:Slovan Bratislava",
    "Sparta Praha": "CZE:AC Sparta Praha",
    "Sporting CP": "POR:Sp Lisbon",
    "Sturm Graz": "AUT:Sturm Graz",
    "Sutjeska": "MNE:Sutjeska",
    "The New Saints": "WAL:The New Saints",
    "Tre Fiori": "SMR:Tre Fiori",
    "Union St. Gilloise": "BEL:St. Gilloise",
    "Universitatea Craiova": "ROU:Universitatea Craiova",
    "Vardar Skopje": "MKD:Vardar Skopje",
    "VfB Stuttgart": "GER:Stuttgart",
    "Viking": "NOR:Viking",
    "Vikingur Reykjavik": "ISL:Víkingur Reykjavík",
    "Villarreal": "ESP:Villarreal",
}

UNMAPPED_PREFIX = "UNMAPPED"


def dom_key(raw: str, div: str) -> str:
    return f"{DIV_COUNTRY[div]}:{raw}"


def db_club_key(team_name: str) -> str | None:
    """Canonical key for a DB team name, or None if it is not in DB_ALIASES."""
    return DB_ALIASES.get(team_name)


def country(key: str) -> str:
    return key.split(":", 1)[0]
