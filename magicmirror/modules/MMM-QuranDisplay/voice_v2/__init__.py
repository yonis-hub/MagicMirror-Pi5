"""Phase 1-3 voice stack add-ons.

Each module is independently optional. Import errors / missing models
should bubble as `Unavailable` so the main listener can fall back gracefully.
"""


class Unavailable(RuntimeError):
    """Raised when a v2 component cannot be initialised (missing deps/model)."""
