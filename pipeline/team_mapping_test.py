"""Tests for canonical team-name mapping (task 2.3)."""
import pytest

from pipeline.team_mapping import normalize_team_name


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Korea Republic", "South Korea"),
        ("korea republic", "South Korea"),
        ("West Germany", "Germany"),
        ("IR Iran", "Iran"),
        ("USA", "United States"),
        ("China PR", "China"),
        ("Czech Republic", "Czechia"),
        ("Türkiye", "Turkey"),
        ("Cabo Verde", "Cape Verde"),
        ("Cape Verde Islands", "Cape Verde"),  # football-data.org's spelling
        ("Bosnia & Herzegovina", "Bosnia and Herzegovina"),  # api-sports' spelling
        ("Republic of Ireland", "Ireland"),
        ("Côte d'Ivoire", "Ivory Coast"),
    ],
)
def test_known_aliases_resolve(raw, expected):
    assert normalize_team_name(raw) == expected


def test_whitespace_is_collapsed_and_trimmed():
    assert normalize_team_name("  Korea   Republic  ") == "South Korea"


def test_unknown_name_returned_trimmed_unchanged():
    assert normalize_team_name("  Brazil ") == "Brazil"


def test_none_and_empty_are_safe():
    assert normalize_team_name(None) == ""
    assert normalize_team_name("") == ""


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Ath Madrid", "Atletico Madrid"),
        ("Betis", "Real Betis"),
        ("Ath Bilbao", "Athletic Club"),
        ("Celta", "Celta Vigo"),
        ("Espanol", "Espanyol"),
        ("La Coruna", "Deportivo La Coruna"),
        ("Sociedad", "Real Sociedad"),
        ("Vallecano", "Rayo Vallecano"),
        ("Bayern Munich", "Bayern München"),
        ("Dortmund", "Borussia Dortmund"),
        ("Leverkusen", "Bayer Leverkusen"),
        ("Augsburg", "FC Augsburg"),
        ("Ein Frankfurt", "Eintracht Frankfurt"),
        ("FC Koln", "1. FC Köln"),
        ("Freiburg", "SC Freiburg"),
        ("Hamburg", "Hamburger SV"),
        ("Hoffenheim", "1899 Hoffenheim"),
        ("M'gladbach", "Borussia Mönchengladbach"),
        ("Mainz", "FSV Mainz 05"),
        ("Paderborn", "SC Paderborn 07"),
        ("Schalke 04", "FC Schalke 04"),
        ("Stuttgart", "VfB Stuttgart"),
        # 2026-27 promoted clubs, as spelled in the in-season SP1/D1 files.
        ("Santander", "Racing Santander"),
        ("Elversberg", "SV Elversberg"),
    ],
)
def test_sp1_d1_club_aliases_resolve_to_the_api_football_spelling(raw, expected):
    """La Liga (SP1) / Bundesliga (D1) football-data.co.uk spellings ->
    API-Football's canonical name -- see team_mapping.py's own section on why
    this reconciliation matters (League Score Predictions Phase 2)."""
    assert normalize_team_name(raw) == expected


def test_e0_hull_alias_resolves_to_the_live_api_football_spelling():
    assert normalize_team_name("Hull") == "Hull City"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Arsenal FC", "Arsenal"),
        ("Aston Villa FC", "Aston Villa"),
        ("AFC Bournemouth", "Bournemouth"),
        ("Brighton & Hove Albion FC", "Brighton"),
        ("Chelsea FC", "Chelsea"),
        ("Coventry City FC", "Coventry"),
        ("Hull City AFC", "Hull City"),
        ("Ipswich Town FC", "Ipswich"),
        ("Leeds United FC", "Leeds"),
        ("Everton FC", "Everton"),
        ("Liverpool FC", "Liverpool"),
        ("Manchester City FC", "Manchester City"),
        ("Manchester United FC", "Manchester United"),
        ("Newcastle United FC", "Newcastle"),
        ("Nottingham Forest FC", "Nottingham Forest"),
        ("Tottenham Hotspur FC", "Tottenham"),
        ("FC Barcelona", "Barcelona"),
        ("Real Madrid CF", "Real Madrid"),
        ("Club Atlético de Madrid", "Atletico Madrid"),
        ("Real Betis Balompié", "Real Betis"),
        ("Real Sociedad de Fútbol", "Real Sociedad"),
        ("Sevilla FC", "Sevilla"),
        ("Valencia CF", "Valencia"),
        ("Villarreal CF", "Villarreal"),
        ("Girona FC", "Girona"),
        ("Getafe CF", "Getafe"),
        ("CA Osasuna", "Osasuna"),
        ("RCD Mallorca", "Mallorca"),
        ("Deportivo Alavés", "Alaves"),
        ("Levante UD", "Levante"),
        ("FC Bayern München", "Bayern München"),
        ("Bayer 04 Leverkusen", "Bayer Leverkusen"),
        ("1. FSV Mainz 05", "FSV Mainz 05"),
        ("TSG 1899 Hoffenheim", "1899 Hoffenheim"),
        ("SV Werder Bremen", "Werder Bremen"),
        ("1. FC Union Berlin", "Union Berlin"),
        ("Paris Saint-Germain FC", "Paris Saint Germain"),
        ("FC Internazionale Milano", "Inter"),
        ("Sporting Clube de Portugal", "Sporting CP"),
        ("Linzer ASK", "Lask Linz"),
        ("Racing Club de Lens", "Lens"),
        ("Lille OSC", "Lille"),
        ("Feyenoord Rotterdam", "Feyenoord"),
        ("SSC Napoli", "Napoli"),
        ("PSV", "PSV Eindhoven"),
        ("Como 1907", "Como"),
        ("FC København", "FC Copenhagen"),
        ("Red Star Belgrade", "FK Crvena Zvezda"),
        ("PFC Ludogorets 1945", "Ludogorets"),
    ],
)
def test_football_data_org_club_names_resolve_to_existing_roster_names(
    raw, expected,
):
    assert normalize_team_name(raw) == expected
