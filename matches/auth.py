from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.conf import settings
from firebase_admin import auth as firebase_auth

from .errors import AuthenticationError, AuthorizationError


@dataclass(frozen=True)
class Principal:
    uid: str
    roles: frozenset[str]
    court_ids: frozenset[str]

    @classmethod
    def from_claims(cls, claims: dict[str, Any]) -> "Principal":
        uid = claims.get("uid") or claims.get("sub")
        if not isinstance(uid, str) or not uid:
            raise AuthenticationError("The Firebase token has no user ID.")

        raw_roles = claims.get("roles", claims.get("role", []))
        if isinstance(raw_roles, str):
            raw_roles = [raw_roles]
        raw_courts = claims.get("court_ids", [])
        if not isinstance(raw_roles, list) or not all(isinstance(role, str) for role in raw_roles):
            raise AuthenticationError("The Firebase roles claim is invalid.")
        if not isinstance(raw_courts, list) or not all(isinstance(court, str) for court in raw_courts):
            raise AuthenticationError("The Firebase court_ids claim is invalid.")
        return cls(uid, frozenset(raw_roles), frozenset(raw_courts))

    @property
    def is_organizer(self) -> bool:
        return "organizer" in self.roles

    def can_read(self, court_id: str) -> bool:
        return self.is_organizer or "read_only" in self.roles or (
            "scorer" in self.roles and court_id in self.court_ids
        )

    def can_score(self, court_id: str) -> bool:
        return self.is_organizer or ("scorer" in self.roles and court_id in self.court_ids)


def authenticate_token(token: str) -> Principal:
    if not isinstance(token, str) or not token:
        raise AuthenticationError("A Firebase ID token is required.")

    # This hook is deliberately settings-only and empty in normal runtime.
    test_claims = settings.FIREBASE_TEST_TOKENS.get(token)
    if test_claims is not None:
        return Principal.from_claims(test_claims)
    try:
        return Principal.from_claims(firebase_auth.verify_id_token(token))
    except Exception as exc:
        raise AuthenticationError("The Firebase ID token is invalid or expired.") from exc


def require_read(principal: Principal, court_id: str) -> None:
    if not principal.can_read(court_id):
        raise AuthorizationError("You cannot access this court's match.")


def require_organizer(principal: Principal) -> None:
    if not principal.is_organizer:
        raise AuthorizationError("Organizer access is required.")


def require_command(principal: Principal, court_id: str, command: str) -> None:
    if command in {"override", "clear_umpire_request", "undo"}:
        require_organizer(principal)
    elif command in {"score_point", "request_umpire"}:
        if not principal.can_score(court_id):
            raise AuthorizationError("Scorer access for this court is required.")
    else:
        require_read(principal, court_id)
