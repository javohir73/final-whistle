"""The false-green regression suite.

The bug these pin: api-sports answers HTTP 200 with an `errors` object when the
key is out of quota, every fetch_* logged it and returned [], and the daily
refresh reported success having ingested nothing. Each test here fails if that
behaviour comes back.
"""
import pytest

from pipeline.ingest.provider_errors import (
    ProviderAuthError,
    ProviderError,
    ProviderQuotaError,
    blocking,
    classify,
    read_payload,
    record,
    reset,
    snapshot,
)


class _Resp:
    """Minimal requests.Response stand-in."""

    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@pytest.fixture(autouse=True)
def _clean_ledger():
    reset()
    yield
    reset()


# --- classification -------------------------------------------------------

def test_empty_error_shapes_are_success():
    # api-sports sends [] on some endpoints and {} on others when all is well.
    assert classify([]) is None
    assert classify({}) is None
    assert classify(None) is None


def test_daily_request_cap_is_quota():
    errors = {"requests": "You have reached the request limit for the day"}
    assert classify(errors) is ProviderQuotaError


def test_per_minute_rate_limit_is_quota():
    assert classify({"rateLimit": "Too many requests"}) is ProviderQuotaError


def test_bad_token_is_auth():
    assert classify({"token": "Error/Missing application key"}) is ProviderAuthError


def test_plan_restriction_is_auth():
    errors = {"plan": "Your plan does not have access to this feature"}
    assert classify(errors) is ProviderAuthError


def test_list_shaped_errors_are_classified_by_text():
    # A few endpoints send bare strings instead of a keyed object.
    assert classify(["You have exceeded the rate limit"]) is ProviderQuotaError
    assert classify(["Your plan does not have access"]) is ProviderAuthError


def test_unrecognised_error_is_still_an_error_not_success():
    # The whole point: anything we can't classify must NOT read as clean.
    assert classify({"bug": "something went sideways"}) is ProviderError


# --- read_payload ---------------------------------------------------------

def test_clean_payload_is_returned():
    payload = {"errors": [], "response": [{"fixture": {"id": 1}}]}
    assert read_payload(_Resp(payload), endpoint="/fixtures") == payload


def test_quota_payload_raises_instead_of_returning_empty():
    payload = {"errors": {"requests": "You have reached the request limit for the day"},
               "response": []}
    with pytest.raises(ProviderQuotaError) as excinfo:
        read_payload(_Resp(payload), endpoint="/fixtures")
    assert excinfo.value.endpoint == "/fixtures"
    assert "requests" in excinfo.value.detail


def test_http_429_raises_quota_not_a_generic_http_error():
    # Must be distinguishable from a 500 so monitoring can say "quota", and
    # must be caught BEFORE raise_for_status flattens it.
    with pytest.raises(ProviderQuotaError):
        read_payload(_Resp({}, status_code=429), endpoint="/fixtures")


def test_http_500_still_raises():
    with pytest.raises(RuntimeError):
        read_payload(_Resp({}, status_code=500), endpoint="/fixtures")


def test_non_object_payload_raises():
    with pytest.raises(ProviderError):
        read_payload(_Resp([1, 2, 3]), endpoint="/fixtures")


# --- incident ledger ------------------------------------------------------

def test_recorded_quota_incident_blocks_the_run():
    record(ProviderQuotaError("out of quota", endpoint="/odds"))
    assert [i["kind"] for i in blocking()] == ["quota"]


def test_repeat_incidents_collapse_to_one_entry_with_a_count():
    for _ in range(3):
        record(ProviderQuotaError("out of quota", endpoint="/odds"))
    entries = snapshot()
    assert len(entries) == 1
    assert entries[0]["count"] == 3


def test_transient_error_is_recorded_but_does_not_block():
    # A single flaky response should not fail the nightly refresh; a systemic
    # quota/auth failure should. This is the line between the two.
    record(ProviderError("flaky", endpoint="/injuries"))
    assert snapshot() != []
    assert blocking() == []


def test_reset_clears_the_ledger():
    record(ProviderQuotaError("out of quota", endpoint="/odds"))
    reset()
    assert snapshot() == []
