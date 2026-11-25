"""UFC rules shared by the API and the picks game. Plain module: no imports from the API layer."""
from __future__ import annotations

import re

# Same rule as the frontend's `isTba` (frontend/lib/ufcDisplay.ts), applied to the trimmed name.
_PLACEHOLDER = re.compile(r"^(opponent\s+)?tba$", re.IGNORECASE)


def is_placeholder_name(name: str | None) -> bool:
    """True for a missing or blank name, "TBA" and "Opponent TBA" (any case, any inner spacing)."""
    if name is None or not name.strip():
        return True
    return _PLACEHOLDER.match(name.strip()) is not None
