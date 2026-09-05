from __future__ import annotations

from copy import deepcopy
from typing import Any

from scoring_engine import MatchStatus, ScoringEngine

from .auth import Principal, require_command, require_organizer, require_read
from .errors import NotFoundError, ValidationError
from .serialization import (
    STATE_FIELDS,
    config_from_firestore,
    config_to_firestore,
    state_from_firestore,
    state_from_engine_data,
    state_to_firestore,
    teams_to_firestore,
    validate_state,
)


MATCH_HISTORY_LIMIT = 100


class MatchService:
    def __init__(self, repository) -> None:
        self.repository = repository

    def create_court(self, principal: Principal | None, payload: Any) -> dict[str, Any]:
        if principal is not None:
            require_organizer(principal)
        if not isinstance(payload, dict) or set(payload) != {"name"}:
            raise ValidationError("A court requires only a name.")
        name = payload["name"]
        if not isinstance(name, str) or not name.strip():
            raise ValidationError("Court name must be a non-empty string.")
        return self.repository.create_court(name.strip())

    def list_courts(self, principal: Principal | None) -> list[dict[str, Any]]:
        courts = self.repository.list_courts()
        if principal is None:
            return courts
        if principal.is_organizer or "read_only" in principal.roles:
            return courts
        return [court for court in courts if court["id"] in principal.court_ids]

    def create_match(self, principal: Principal | None, payload: Any) -> dict[str, Any]:
        if principal is not None:
            require_organizer(principal)
        required = {"court_id", "teams", "match_type", "config"}
        if not isinstance(payload, dict) or set(payload) != required:
            raise ValidationError("A match requires court_id, teams, match_type, and config.")
        court_id = payload["court_id"]
        if not isinstance(court_id, str) or not self.repository.court_exists(court_id):
            raise NotFoundError("Court not found.")

        config = config_from_firestore(payload["teams"], payload["match_type"], payload["config"])
        engine = ScoringEngine(config)
        validate_state(engine.state, config)
        document = {
            "court_id": court_id,
            "teams": teams_to_firestore(config.teams),
            "match_type": config.match_type.value,
            "config": config_to_firestore(config),
            "state": state_to_firestore(engine.state),
            "history": [],
        }
        return self.snapshot(self.repository.create_match(document))

    def get_match(self, principal: Principal | None, match_id: str) -> dict[str, Any]:
        document = self.repository.get_match(match_id)
        if principal is not None:
            require_read(principal, document["court_id"])
        return self.snapshot(document)

    def list_matches(self, principal: Principal | None) -> list[dict[str, Any]]:
        documents = self.repository.list_matches()
        if principal is None:
            return [self.snapshot(item) for item in documents]
        return [self.snapshot(item) for item in documents if principal.can_read(item["court_id"])]

    def mutate(
        self,
        principal: Principal | None,
        match_id: str,
        command: str,
        payload: Any,
    ) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValidationError("payload must be an object.")

        def apply(document: dict[str, Any]) -> dict[str, Any]:
            if principal is not None:
                require_command(principal, document["court_id"], command)
            config = config_from_firestore(document["teams"], document["match_type"], document["config"])
            state = state_from_firestore(document["state"], config)
            engine = ScoringEngine(config, state)
            history = deepcopy(document.get("history", []))
            if not isinstance(history, list):
                raise ValidationError("match history must be an array.")

            try:
                if command == "score_point":
                    if set(payload) != {"winner_team"}:
                        raise ValidationError("score_point payload requires only winner_team.")
                    engine.score_point(payload["winner_team"])
                elif command == "undo":
                    if payload:
                        raise ValidationError("undo payload must be empty.")
                    if not history:
                        raise ValidationError("No scoring actions to undo.")
                    engine.state = state_from_firestore(history.pop(), config)
                elif command == "request_umpire":
                    if payload:
                        raise ValidationError("request_umpire payload must be empty.")
                    engine.request_umpire()
                elif command == "clear_umpire_request":
                    if payload:
                        raise ValidationError("clear_umpire_request payload must be empty.")
                    engine.clear_umpire_request()
                elif command == "override":
                    self._apply_override(engine, payload)
                else:
                    raise ValidationError(f"Unsupported command: {command}.")
            except (AttributeError, IndexError, RuntimeError, TypeError, ValueError) as exc:
                raise ValidationError(str(exc)) from exc

            validate_state(engine.state, config)
            updated = {
                "id": document["id"],
                "court_id": document["court_id"],
                "teams": deepcopy(document["teams"]),
                "match_type": document["match_type"],
                "config": deepcopy(document["config"]),
                "state": state_to_firestore(engine.state),
                "history": history
                if command == "undo"
                else [*history, deepcopy(document["state"])][-MATCH_HISTORY_LIMIT:],
            }
            return updated

        return self.snapshot(self.repository.transact_match(match_id, apply))

    def snapshot(self, document: dict[str, Any]) -> dict[str, Any]:
        config = config_from_firestore(document["teams"], document["match_type"], document["config"])
        state = state_from_firestore(document["state"], config)
        engine = ScoringEngine(config, state)
        return {
            "match_id": document["id"],
            "court_id": document["court_id"],
            "teams": teams_to_firestore(config.teams),
            "match_type": config.match_type.value,
            "config": config_to_firestore(config),
            "state": state.to_dict(),
            "display_score": engine.display_score(),
        }

    @staticmethod
    def _apply_override(engine: ScoringEngine, payload: dict[str, Any]) -> None:
        if set(payload) != {"changes"} or not isinstance(payload["changes"], dict):
            raise ValidationError("override payload requires a changes object.")
        changes = payload["changes"]
        allowed = STATE_FIELDS - {"last_action"}
        unknown = set(changes) - allowed
        if unknown:
            raise ValidationError(f"Unknown override field(s): {', '.join(sorted(unknown))}.")
        if not changes:
            raise ValidationError("override changes cannot be empty.")

        candidate_data = engine.state.to_dict()
        candidate_data.update(deepcopy(changes))
        candidate_data["last_action"] = "organizer_override"
        candidate = state_from_engine_data(candidate_data, engine.config)
        if candidate.status == MatchStatus.COMPLETE and candidate.winner_team is None:
            raise ValidationError("A completed override must identify the winner.")
        engine.state = candidate
