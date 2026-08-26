"""Contracts for the test suite's external-network guard."""

import pytest
import requests


def test_network_guard_contract(_block_external_requests):
    with pytest.raises(AssertionError, match="unmocked external HTTP"):
        requests.get("https://example.invalid/provider-test")
