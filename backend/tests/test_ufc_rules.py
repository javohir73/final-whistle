"""UFC rules shared by the API and the picks game."""
from __future__ import annotations

import pytest

from app.ufc_rules import is_placeholder_name


@pytest.mark.parametrize("name,expected", [
    ("TBA", True), ("tba", True), (" Opponent TBA ", True), ("opponent   tba", True),
    ("", True), (None, True),
    ("Shara Magomedov", False), ("Tbarra Silva", False), ("Opponent", False),
])
def test_is_placeholder_name(name, expected):
    assert is_placeholder_name(name) is expected
