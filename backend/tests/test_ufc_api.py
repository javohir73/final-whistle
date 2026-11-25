"""GET /api/ufc/events, /events/next, /events/{slug}: the public, read-only UFC
card API. In-memory SQLite hands timezone-aware columns back naive, so the
datetime tests pin that the API always sends the UTC zone."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.cache import cache
from app.db import Base, get_db
from app.main import app
from app.models import UfcBout, UfcEvent, UfcFighter
from pipeline.sports.ufc_ingest import slugify

ADESANYA = "ufc-fight-night-adesanya-vs-magomedov"
PROCHAZKA = "ufc-fight-night-prochazka-vs-stirling"
UFC300 = "ufc-300-pereira-vs-hill"
DWCS = "dwcs-week-1"
STALE = "ufc-fight-night-stale-card"
EMPTY = "ufc-empty-card-2027"
BIG = "ufc-big-card"


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    cache.clear()
    yield TestClient(app), TestingSession, engine
    cache.clear()
    app.dependency_overrides.clear()


_pid = [0]


def _next_pid() -> str:
    _pid[0] += 1
    return str(_pid[0])


def _fighter(db, name, slug=None, **kw):
    f = UfcFighter(
        provider="espn", provider_fighter_id=_next_pid(), name=name,
        slug=slug or slugify(name), **kw,
    )
    db.add(f)
    db.flush()
    return f


def _event(db, slug, status, first=None, last=None, is_card=True, name=None):
    e = UfcEvent(
        provider="espn", provider_event_id=_next_pid(), name=name or slug, slug=slug,
        status=status, first_bout_utc=first, last_bout_utc=last, is_card=is_card,
        venue="Arena",
    )
    db.add(e)
    db.flush()
    return e


def _bout(db, ev, a, b, **kw):
    bt = UfcBout(
        event_id=ev.id, provider="espn", provider_bout_id=_next_pid(),
        fighter_a_id=a.id, fighter_b_id=b.id, **kw,
    )
    db.add(bt)
    db.flush()
    return bt


def _seed(db, now, with_future=True):
    f = {}
    f["pro"] = _fighter(
        db, "Jiří Procházka", "jiri-prochazka", date_of_birth=date(1992, 10, 14),
        height_in=75, reach_in=80, stance="Orthodox", country="Czech Republic",
    )
    f["nav"] = _fighter(db, "Navajo Stirling")
    f["ali"] = _fighter(db, "Aljamain Sterling")
    f["kev"] = _fighter(db, "Kevin Vallejos")
    f["ade"] = _fighter(db, "Israel Adesanya")
    f["mag"] = _fighter(db, "Shara Magomedov")
    f["reb"] = _fighter(db, "Mateusz Rębecki")
    f["bre"] = _fighter(db, "Elves Brener")
    f["hus"] = _fighter(db, "Abdul Hussein")
    f["tba"] = _fighter(db, "TBA", "tba-5300001")

    if with_future:
        d10 = now + timedelta(days=10)
        main_t = d10.replace(hour=18, minute=0, second=0, microsecond=0)
        pre_t = main_t - timedelta(hours=3)
        ev = _event(db, ADESANYA, "scheduled", pre_t, main_t)
        _bout(db, ev, f["ade"], f["mag"], card_order=1, segment="main",
              segment_label="Main Card", weight_class="Middleweight",
              scheduled_rounds=5, scheduled_utc=main_t, status="scheduled")
        _bout(db, ev, f["ade"], f["bre"], card_order=2, segment="main",
              segment_label="Main Card", scheduled_utc=main_t, status="changed")
        _bout(db, ev, f["ali"], f["kev"], card_order=3, segment="main",
              segment_label="Main Card", scheduled_utc=main_t, status="cancelled",
              method_detail="cancelled by feed")
        _bout(db, ev, f["reb"], f["bre"], card_order=12, segment="prelims1",
              segment_label="Prelims", scheduled_utc=pre_t, status="scheduled")
        _bout(db, ev, f["hus"], f["tba"], card_order=14, segment="prelims1",
              segment_label="Prelims", scheduled_utc=pre_t, status="scheduled")
        t = now + timedelta(days=24)
        _event(db, EMPTY, "scheduled", t, t)

    t4 = now - timedelta(days=4)
    ev = _event(db, PROCHAZKA, "finished", t4, t4)
    _bout(db, ev, f["pro"], f["nav"], card_order=1, segment="main", segment_label="Main Card",
          status="finished", winner="b", method="ko_tko", method_detail="Punch",
          end_round=2, end_clock="4:58", scheduled_utc=t4)
    _bout(db, ev, f["ali"], f["kev"], card_order=2, segment="main", segment_label="Main Card",
          status="finished", winner="b", method="decision",
          method_detail="Decision - Unanimous", end_round=3, end_clock="5:00",
          scheduled_utc=t4)
    _bout(db, ev, f["reb"], f["hus"], card_order=3, segment="main", segment_label="Main Card",
          status="finished", winner=None, method="draw", method_detail="Majority",
          end_round=3, end_clock="5:00", scheduled_utc=t4)

    t40 = now - timedelta(days=40)
    ev = _event(db, UFC300, "finished", t40, t40)
    _bout(db, ev, f["pro"], f["kev"], card_order=1, segment="main", segment_label="Main Card",
          status="finished", winner="a", method="submission", end_round=1,
          end_clock="3:01", scheduled_utc=t40)
    _bout(db, ev, f["nav"], f["bre"], card_order=2, segment="main", segment_label="Main Card",
          status="finished", winner=None, method="no_contest",
          method_detail="Accidental eye poke", end_round=1, end_clock="2:10",
          scheduled_utc=t40)

    t20 = now - timedelta(days=20)
    ev = _event(db, DWCS, "finished", t20, t20, is_card=False)
    _bout(db, ev, f["pro"], f["bre"], card_order=1, segment="main", status="finished",
          winner="a", method="decision", scheduled_utc=t20)

    t10 = now - timedelta(days=10)
    ev = _event(db, STALE, "scheduled", t10, t10)
    _bout(db, ev, f["ade"], f["hus"], card_order=1, segment="main", scheduled_utc=t10)
    _bout(db, ev, f["mag"], f["reb"], card_order=2, segment="main", scheduled_utc=t10)

    db.commit()
    return f


def _seed_big(db, now):
    """A 12-bout card for the query-count test."""
    tb = now + timedelta(days=30)
    ev = _event(db, BIG, "scheduled", tb, tb)
    for i in range(12):
        a = _fighter(db, f"Big A{i}")
        b = _fighter(db, f"Big B{i}")
        _bout(db, ev, a, b, card_order=i + 1, segment="main" if i < 5 else "prelims1",
              segment_label="Main Card" if i < 5 else "Prelims", scheduled_utc=tb)
    db.commit()


def _seeded(client, with_future=True):
    c, Session, engine = client
    db = Session()
    _seed(db, datetime.now(timezone.utc), with_future=with_future)
    db.close()
    return c, Session, engine


def _slugs(r):
    return [e["slug"] for e in r.json()["events"]]


def _by_order(detail, order):
    for seg in detail["segments"]:
        for b in seg["bouts"]:
            if b["card_order"] == order:
                return b
    raise AssertionError(f"no bout with order {order}")


def test_upcoming_is_soonest_first_cards_only(client):
    c, _, _ = _seeded(client)
    body = c.get("/api/ufc/events", params={"when": "upcoming"}).json()
    assert [e["slug"] for e in body["events"]] == [ADESANYA, EMPTY]
    first = body["events"][0]
    assert first["bout_count"] == 3 and first["main_event"]["fighter_a"]["name"] == "Israel Adesanya"


def test_past_is_most_recent_first_and_includes_a_stale_card(client):
    c, _, _ = _seeded(client)
    r = c.get("/api/ufc/events", params={"when": "past"})
    assert _slugs(r) == [PROCHAZKA, STALE, UFC300]


def test_paging_and_bounds(client):
    c, _, _ = _seeded(client)
    r = c.get("/api/ufc/events", params={"when": "past", "limit": 1, "offset": 1})
    assert _slugs(r) == [STALE]
    assert c.get("/api/ufc/events", params={"when": "soon"}).status_code == 422
    assert c.get("/api/ufc/events", params={"when": "past", "limit": 51}).status_code == 422


def test_next_is_the_soonest_upcoming_card(client):
    c, _, _ = _seeded(client)
    assert c.get("/api/ufc/events/next").json()["slug"] == ADESANYA


def test_next_falls_back_to_the_latest_result(client):
    c, _, _ = _seeded(client, with_future=False)
    assert c.get("/api/ufc/events/next").json()["slug"] == PROCHAZKA


def test_next_is_404_when_nothing_is_loaded(client):
    c, _, _ = client
    r = c.get("/api/ufc/events/next")
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_events"


def test_card_segments_and_order(client):
    c, _, _ = _seeded(client)
    d = c.get(f"/api/ufc/events/{ADESANYA}").json()
    assert [(s["key"], s["label"]) for s in d["segments"]] == [("main", "Main Card"), ("prelims1", "Prelims")]
    assert [b["card_order"] for b in d["segments"][0]["bouts"]] == [1, 3]
    assert [b["card_order"] for b in d["segments"][1]["bouts"]] == [12, 14]


def test_cancelled_rows_are_served_without_the_feed_marker(client):
    c, _, _ = _seeded(client)
    r = c.get(f"/api/ufc/events/{ADESANYA}")
    cancelled = _by_order(r.json(), 3)
    assert cancelled["status"] == "cancelled" and cancelled["result"] is None
    assert "cancelled by feed" not in r.text


def test_result_only_when_finished(client):
    c, _, _ = _seeded(client)
    fin = c.get(f"/api/ufc/events/{PROCHAZKA}").json()
    up = c.get(f"/api/ufc/events/{ADESANYA}").json()
    ko = _by_order(fin, 1)
    assert ko["result"] == {"winner": "b", "method": "ko_tko", "method_detail": "Punch", "end_round": 2, "end_clock": "4:58"}
    assert _by_order(up, 1)["result"] is None
    assert _by_order(fin, 3)["result"]["winner"] is None and _by_order(fin, 3)["result"]["method"] == "draw"


def test_records_count_stored_card_fights_only(client):
    c, _, _ = _seeded(client)
    fin = c.get(f"/api/ufc/events/{PROCHAZKA}").json()
    up = c.get(f"/api/ufc/events/{ADESANYA}").json()
    mini = _by_order(fin, 1)["fighter_a"]
    assert mini["record"] == {"wins": 1, "losses": 1, "draws": 0, "no_contests": 0}
    assert _by_order(fin, 1)["fighter_b"]["record"] == {"wins": 1, "losses": 0, "draws": 0, "no_contests": 1}
    assert _by_order(up, 1)["fighter_b"]["record"] is None


def test_card_with_zero_bouts(client):
    c, _, _ = _seeded(client)
    d = c.get(f"/api/ufc/events/{EMPTY}").json()
    assert (d["segments"], d["bout_count"], d["main_event"]) == ([], 0, None)


def test_unknown_and_non_card_slugs_are_404(client):
    c, _, _ = _seeded(client)
    for slug in ("no-such-card", DWCS):
        r = c.get(f"/api/ufc/events/{slug}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_card_query_count_does_not_grow_with_bouts(client):
    c, Session, engine = _seeded(client)
    db = Session()
    _seed_big(db, datetime.now(timezone.utc))
    db.close()

    def count(slug):
        n = [0]

        def listener(*a, **k):
            n[0] += 1

        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert c.get(f"/api/ufc/events/{slug}").status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return n[0]

    small, big = count(ADESANYA), count(BIG)
    assert small == big and big <= 6


def test_datetimes_are_utc(client):
    c, _, _ = _seeded(client)
    d = c.get(f"/api/ufc/events/{ADESANYA}").json()
    for v in (d["first_bout_utc"], d["segments"][0]["scheduled_utc"],
              d["segments"][0]["bouts"][0]["scheduled_utc"]):
        assert datetime.fromisoformat(v.replace("Z", "+00:00")).utcoffset() == timedelta(0)


def test_public_cache_header(client):
    c, _, _ = _seeded(client)
    assert c.get("/api/ufc/events", params={"when": "upcoming"}).headers["cache-control"] == \
        "public, max-age=60, stale-while-revalidate=300"


def _keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from _keys(v)


def test_no_model_odds_or_pick_fields(client, monkeypatch):
    from app.config import settings
    from app.models import UfcPrediction

    c, Session, _ = _seeded(client)
    # Arm the guard: a public model and a counting call on every open bout, so a model
    # field that leaked for an open fight would show up below.
    monkeypatch.setattr(settings, "ufc_public_model", "ufc-form-v0.2")
    secret = "Reason text that only a leak could show."
    db = Session()
    open_bouts = db.query(UfcBout).join(UfcEvent, UfcEvent.id == UfcBout.event_id).filter(
        UfcEvent.slug == ADESANYA, UfcBout.status == "scheduled").all()
    assert len(open_bouts) >= 2
    for b in open_bouts:
        db.add(UfcPrediction(
            bout_id=b.id, model_version="ufc-form-v0.2", p_a=0.61, p_b=0.39,
            method_probs={"ko_tko": 0.2, "submission": 0.1, "decision": 0.7}, reasons=[secret],
            is_shadow=True, created_at=datetime.now(timezone.utc) - timedelta(hours=1)))
    db.commit()
    db.close()
    banned = {"p_a", "p_b", "prediction", "predictions", "odds", "moneyline_a",
              "moneyline_b", "pick", "picks", "rating"}
    for url, params in (
        ("/api/ufc/events", {"when": "upcoming"}), ("/api/ufc/events", {"when": "past"}),
        ("/api/ufc/events/next", {}), (f"/api/ufc/events/{PROCHAZKA}", {}),
        (f"/api/ufc/bouts/{_bout_id(Session, PROCHAZKA, 1)}", {}),
        (f"/api/ufc/bouts/{_bout_id(Session, ADESANYA, 3)}", {}),
        ("/api/ufc/fighters/jiri-prochazka", {}), ("/api/ufc/fighters/navajo-stirling", {}),
    ):
        r = c.get(url, params=params)
        assert not banned & set(_keys(r.json())), url
        assert secret not in r.text and "0.61" not in r.text, url


def test_feed_marker_matches_the_pipeline():
    from pipeline.sports.ufc_ingest import FEED_CANCELLED as PIPELINE
    from app.api.ufc import FEED_CANCELLED
    assert FEED_CANCELLED == PIPELINE


# ---- fight and fighter detail (task 3) ----
from app.api.ufc import age_on  # noqa: E402
from app.models import UfcBoutStat  # noqa: E402

_STAT_FIELDS = {"knockdowns", "sig_strikes_landed", "sig_strikes_attempted", "total_strikes_landed",
                "total_strikes_attempted", "takedowns_landed", "takedowns_attempted",
                "submission_attempts", "reversals", "control_seconds"}


def _bout_id(Session, event_slug, order):
    db = Session()
    try:
        return db.query(UfcBout).join(UfcEvent, UfcEvent.id == UfcBout.event_id).filter(
            UfcEvent.slug == event_slug, UfcBout.card_order == order).one().id
    finally:
        db.close()


def _stat(db, bout_id, fighter_id, **kw):
    db.add(UfcBoutStat(bout_id=bout_id, fighter_id=fighter_id, **kw))


def _fid(Session, slug):
    db = Session()
    try:
        return db.query(UfcFighter).filter_by(slug=slug).one().id
    finally:
        db.close()


def _ko_stats(Session):
    ko = _bout_id(Session, PROCHAZKA, 1)
    db = Session()
    b = db.get(UfcBout, ko)
    _stat(db, ko, b.fighter_a_id, knockdowns=0, sig_strikes_landed=23, sig_strikes_attempted=40,
          total_strikes_landed=26, total_strikes_attempted=48, takedowns_landed=0,
          takedowns_attempted=0, submission_attempts=0, reversals=0, control_seconds=18)
    _stat(db, ko, b.fighter_b_id, knockdowns=1, sig_strikes_landed=20, sig_strikes_attempted=30,
          total_strikes_landed=21, total_strikes_attempted=32, control_seconds=0)
    db.commit()
    db.close()
    return ko


def test_ko_fight_has_result_stats_and_no_judges(client):
    c, Session, _ = _seeded(client)
    ko = _ko_stats(Session)
    d = c.get(f"/api/ufc/bouts/{ko}").json()
    assert d["event"]["slug"] == PROCHAZKA and d["segment"] == {"key": "main", "label": "Main Card"}
    assert d["stats"]["a"]["control_seconds"] == 18 and d["stats"]["a"]["total_strikes_attempted"] == 48
    assert set(d["stats"]["a"]) == _STAT_FIELDS
    assert d["judges"] is None


def test_decision_has_judges(client):
    c, Session, _ = _seeded(client)
    bid = _bout_id(Session, PROCHAZKA, 2)
    db = Session()
    b = db.get(UfcBout, bid)
    _stat(db, bid, b.fighter_a_id, judges=[27, 28, 27])
    _stat(db, bid, b.fighter_b_id, judges=[30, 29, 30])
    db.commit()
    db.close()
    d = c.get(f"/api/ufc/bouts/{bid}").json()
    assert d["judges"] == {"a": [27, 28, 27], "b": [30, 29, 30]}


def test_tape_and_age_at_fight_time(client):
    c, Session, _ = _seeded(client)
    ko = _bout_id(Session, PROCHAZKA, 1)
    db = Session()
    db.get(UfcBout, ko).scheduled_utc = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)
    db.commit()
    db.close()
    d = c.get(f"/api/ufc/bouts/{ko}").json()
    assert d["tape"]["a"] == {"age": 34, "height_in": 75.0, "reach_in": 80.0, "stance": "Orthodox"}
    up = c.get(f"/api/ufc/bouts/{_bout_id(Session, ADESANYA, 1)}").json()
    assert up["tape"]["b"] == {"age": None, "height_in": None, "reach_in": None, "stance": None}
    assert up["stats"] is None and up["judges"] is None


def test_age_on():
    assert age_on(date(1992, 10, 14), datetime(2026, 10, 13, tzinfo=timezone.utc)) == 33
    assert age_on(date(1992, 10, 14), datetime(2026, 10, 14, tzinfo=timezone.utc)) == 34
    assert age_on(None, datetime(2026, 1, 1, tzinfo=timezone.utc)) is None


def test_stats_null_when_one_side_is_missing(client):
    c, Session, _ = _seeded(client)
    ko = _bout_id(Session, PROCHAZKA, 1)
    db = Session()
    _stat(db, ko, db.get(UfcBout, ko).fighter_a_id, knockdowns=0)
    db.commit()
    db.close()
    assert c.get(f"/api/ufc/bouts/{ko}").json()["stats"] is None


def test_fight_404s(client):
    c, Session, _ = _seeded(client)
    db = Session()
    changed = db.query(UfcBout).filter_by(status="changed").one().id
    dwcs = db.query(UfcBout).join(UfcEvent, UfcEvent.id == UfcBout.event_id).filter(
        UfcEvent.slug == DWCS).one().id
    db.close()
    for bid in (999999, changed, dwcs):
        r = c.get(f"/api/ufc/bouts/{bid}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_stale_scheduled_bout_is_still_served_by_id(client):
    c, Session, _ = _seeded(client)
    r = c.get(f"/api/ufc/bouts/{_bout_id(Session, STALE, 1)}")
    assert r.status_code == 200 and r.json()["status"] == "scheduled"
    assert "cancelled by feed" not in c.get(f"/api/ufc/bouts/{_bout_id(Session, ADESANYA, 3)}").text


def test_fighter_profile_record_and_history(client):
    c, _, _ = _seeded(client)
    d = c.get("/api/ufc/fighters/jiri-prochazka").json()
    assert d["record"] == {"wins": 1, "losses": 1, "draws": 0, "no_contests": 0}
    assert [b["outcome"] for b in d["bouts"]] == ["loss", "win"]
    assert d["bouts"][0]["opponent"] == {"slug": "navajo-stirling", "name": "Navajo Stirling", "country": None}
    assert d["bouts"][0]["method"] == "ko_tko" and d["bouts"][0]["end_round"] == 2
    assert d["bouts"][0]["event"]["slug"] == PROCHAZKA


def test_fighter_upcoming_first_and_cancelled_kept(client):
    c, _, _ = _seeded(client)
    rebecki = c.get("/api/ufc/fighters/mateusz-rebecki").json()
    assert [b["outcome"] for b in rebecki["bouts"]] == [None, "draw"]
    stirling = c.get("/api/ufc/fighters/navajo-stirling").json()
    assert "no_contest" in [b["outcome"] for b in stirling["bouts"]]


def test_fighter_without_history(client):
    c, _, _ = _seeded(client)
    d = c.get("/api/ufc/fighters/shara-magomedov").json()
    assert (d["record"], d["age"], d["date_of_birth"]) == (None, None, None) and len(d["bouts"]) == 1


def test_fighter_history_drops_unresolved_past_scheduled_bouts(client):
    c, Session, _ = client
    db = Session()
    now = datetime.now(timezone.utc)
    x, y = _fighter(db, "Stale Sam"), _fighter(db, "Other One")
    old = _event(db, "old-card", "scheduled", now - timedelta(days=10), now - timedelta(days=10))
    soon = _event(db, "later-card", "scheduled", now + timedelta(days=5), now + timedelta(days=5))
    _event(db, "tonight-card", "live", now - timedelta(hours=2), now - timedelta(hours=2))
    _bout(db, old, x, y, card_order=1, scheduled_utc=now - timedelta(days=10), status="scheduled")
    _bout(db, soon, x, y, card_order=1, scheduled_utc=now + timedelta(days=5), status="scheduled")
    db.commit()
    db.close()
    d = c.get("/api/ufc/fighters/stale-sam").json()
    assert [b["event"]["slug"] for b in d["bouts"]] == ["later-card"]
    db = Session()
    _bout(db, db.query(UfcEvent).filter_by(slug="tonight-card").one(), db.query(UfcFighter).filter_by(slug="stale-sam").one(),
          db.query(UfcFighter).filter_by(slug="other-one").one(), card_order=1,
          scheduled_utc=now - timedelta(hours=2), status="live")
    db.commit()
    db.close()
    d = c.get("/api/ufc/fighters/stale-sam").json()
    assert [b["event"]["slug"] for b in d["bouts"]] == ["later-card", "tonight-card"]


def test_fighter_404(client):
    c, _, _ = _seeded(client)
    r = c.get("/api/ufc/fighters/nobody")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def _count(c, engine, url):
    n = [0]

    def listener(*a, **k):
        n[0] += 1

    event.listen(engine, "before_cursor_execute", listener)
    try:
        assert c.get(url).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return n[0]


def test_detail_query_counts_are_bounded(client):
    c, Session, engine = _seeded(client)
    ko = _ko_stats(Session)
    assert _count(c, engine, f"/api/ufc/bouts/{ko}") <= 7
    db = Session()
    now = datetime.now(timezone.utc)
    hero = _fighter(db, "Busy Bee")
    ev2 = _event(db, "busy-2", "finished", now - timedelta(days=60), now - timedelta(days=60))
    for i in range(2):
        _bout(db, ev2, hero, _fighter(db, f"Foe {i}"), card_order=i + 1, status="finished",
              winner="a", method="decision", scheduled_utc=now - timedelta(days=60 + i))
    db.commit()
    two = _count(c, engine, "/api/ufc/fighters/busy-bee")
    ev8 = _event(db, "busy-8", "finished", now - timedelta(days=90), now - timedelta(days=90))
    for i in range(6):
        _bout(db, ev8, hero, _fighter(db, f"Rival {i}"), card_order=i + 1, status="finished",
              winner="b", method="ko_tko", scheduled_utc=now - timedelta(days=90 + i))
    db.commit()
    db.close()
    eight = _count(c, engine, "/api/ufc/fighters/busy-bee")
    assert two == eight and eight <= 6


# ---- task 2 review fixes ----
def test_huge_offset_and_ids_are_clean_4xx_in_the_envelope(client):
    c, _, _ = _seeded(client)
    for url in (
        "/api/ufc/events?when=past&offset=100000000000000000000",
        "/api/ufc/events?when=past&limit=0",
        "/api/ufc/bouts/100000000000000000000",
        "/api/ufc/bouts/0",
    ):
        r = c.get(url)
        assert 400 <= r.status_code < 500, url
        assert "code" in r.json()["error"], url


def test_undated_finished_card_sorts_last_and_is_not_next(client):
    c, Session, _ = client
    db = Session()
    now = datetime.now(timezone.utc)
    _event(db, "undated-finished", "finished")
    _event(db, "dated-finished", "finished", now - timedelta(days=3), now - timedelta(days=3))
    db.commit()
    db.close()
    r = c.get("/api/ufc/events", params={"when": "past"})
    assert _slugs(r) == ["dated-finished", "undated-finished"]
    assert c.get("/api/ufc/events/next").json()["slug"] == "dated-finished"


def test_malformed_slugs_are_4xx_in_the_envelope_on_both_endpoints(client):
    c, _, _ = _seeded(client)
    for prefix in ("events", "fighters"):
        for bad in ("a%00b", "a%2Fb", "x" * 221, "Upper-Case", "a b", "r%C4%99becki"):
            r = c.get(f"/api/ufc/{prefix}/{bad}")
            assert 400 <= r.status_code < 500, (prefix, bad)
            assert "code" in r.json()["error"], (prefix, bad)
    assert c.get(f"/api/ufc/fighters/{'x' * 141}").status_code == 422
    assert c.get(f"/api/ufc/fighters/{'x' * 140}").status_code == 404
    assert c.get(f"/api/ufc/events/{'x' * 220}").status_code == 404


def test_every_seeded_slug_resolves(client):
    c, Session, _ = _seeded(client)
    db = Session()
    fighters = [f.slug for f in db.query(UfcFighter) if f.name != "TBA"]
    events = [e.slug for e in db.query(UfcEvent).filter_by(is_card=True)]
    db.close()
    assert all(c.get(f"/api/ufc/fighters/{s}").status_code == 200 for s in fighters)
    assert c.get("/api/ufc/fighters/tba-5300001").status_code == 404
    assert all(c.get(f"/api/ufc/events/{s}").status_code == 200 for s in events)


def test_b_side_winner_is_a_win_with_the_a_side_as_opponent(client):
    c, _, _ = _seeded(client)
    d = c.get("/api/ufc/fighters/navajo-stirling").json()
    top = d["bouts"][0]   # the knockout of Procházka, stored with Stirling as b
    assert top["outcome"] == "win" and top["opponent"]["slug"] == "jiri-prochazka"
    pro = c.get("/api/ufc/fighters/jiri-prochazka").json()["bouts"][0]
    assert pro["outcome"] == "loss" and pro["opponent"]["slug"] == "navajo-stirling"


def test_live_bout_past_the_grace_window_is_dropped_but_the_boundary_is_kept(client):
    c, Session, _ = client
    db = Session()
    now = datetime.now(timezone.utc)
    x, y = _fighter(db, "Grace Gary"), _fighter(db, "Grace Foe")
    for slug, delta in (("far-card", timedelta(hours=24, minutes=5)), ("edge-card", timedelta(hours=23, minutes=55))):
        ev = _event(db, slug, "live", now - delta, now - delta)
        _bout(db, ev, x, y, card_order=1, scheduled_utc=now - delta, status="live")
    db.commit()
    db.close()
    d = c.get("/api/ufc/fighters/grace-gary").json()
    assert [b["event"]["slug"] for b in d["bouts"]] == ["edge-card"]


# ---- data quality: impossible measurements and placeholder fighters ----
def test_tape_and_fighter_hide_impossible_measurements(client):
    c, Session, _ = client
    db = Session()
    now = datetime.now(timezone.utc) + timedelta(days=5)
    a = _fighter(db, "Real Fighter", height_in=70, reach_in=72, stance="Orthodox")
    b = _fighter(db, "Opponent Q", height_in=0, reach_in=0, stance="--")
    ev = _event(db, "ufc-dq-card", "scheduled", now, now)
    bt = _bout(db, ev, a, b, status="scheduled", scheduled_utc=now, card_order=1)
    db.commit()
    bout_id, slug = bt.id, b.slug
    db.close()
    tape = c.get(f"/api/ufc/bouts/{bout_id}").json()["tape"]
    assert (tape["a"]["height_in"], tape["a"]["reach_in"], tape["a"]["stance"]) == (70, 72, "Orthodox")
    assert (tape["b"]["height_in"], tape["b"]["reach_in"], tape["b"]["stance"]) == (None, None, None)
    body = c.get(f"/api/ufc/fighters/{slug}").json()
    assert (body["height_in"], body["reach_in"], body["stance"]) == (None, None, None)


@pytest.mark.parametrize("name", ["TBA", "Opponent TBA"])
def test_fighter_detail_is_404_for_a_placeholder(client, name):
    c, Session, _ = client
    db = Session()
    f = _fighter(db, name, slug=slugify(name) + "-9")
    db.commit()
    slug = f.slug
    db.close()
    r = c.get(f"/api/ufc/fighters/{slug}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert r.json()["error"]["message"] == "No UFC fighter with that name"
