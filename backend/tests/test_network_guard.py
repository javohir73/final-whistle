"""Contracts for the test suite's external-network guard."""

import pytest
import requests


def test_network_guard_contract(_block_external_requests):
    with pytest.raises(AssertionError, match="unmocked external HTTP"):
        requests.get("https://example.invalid/provider-test")


def test_network_guard_opt_in_restores_session_request(_allow_external_requests):
    assert (
        requests.sessions.Session.request
        is _allow_external_requests["original_request"]
    )
    assert requests.sessions.Session.request is not _allow_external_requests["blocked_request"]
