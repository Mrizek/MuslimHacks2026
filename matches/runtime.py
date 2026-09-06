from __future__ import annotations

from threading import Lock

from .repositories import FirestoreMatchRepository
from .services import MatchService


_service = None
_lock = Lock()


def get_match_service() -> MatchService:
    global _service
    if _service is None:
        with _lock:
            if _service is None:
                _service = MatchService(FirestoreMatchRepository())
    return _service


def set_match_service(service: MatchService | None) -> None:
    """Replace the service for tests; production leaves the default untouched."""
    global _service
    _service = service
