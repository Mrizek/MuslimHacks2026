from __future__ import annotations

from dataclasses import fields
from typing import Any

from scoring_engine import MatchConfig, MatchState, MatchStatus, MatchType, Team

from .errors import ValidationError


CONFIG_FIELDS = {
    "no_ad",
    "games_per_set",
    "tiebreak_at",
    "tiebreak_points",
    "deciding_tiebreak_points",
    "sets_to_win",
    "starting_server_team",
    "starting_server_player",
    "serving_orders",
    "receiving_orders",
}
STATE_FIELDS = {field.name for field in fields(MatchState)}


def _exact_keys(data: dict[str, Any], allowed: set[str], label: str, *, required: bool) -> None:
    unknown = set(data) - allowed
    missing = allowed - set(data) if required else set()
    if unknown:
        raise ValidationError(f"Unknown {label} field(s): {', '.join(sorted(unknown))}.")
    if missing:
        raise ValidationError(f"Missing {label} field(s): {', '.join(sorted(missing))}.")


def _pair(value: Any, name: str) -> list[int]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValidationError(f"{name} must contain exactly two integers.")
    if any(type(item) is not int or item < 0 for item in value):
        raise ValidationError(f"{name} values must be non-negative integers.")
    return list(value)


def _orders_from_firestore(value: Any, name: str) -> tuple[tuple[int, ...], tuple[int, ...]]:
    if not isinstance(value, dict) or set(value) != {"team_0", "team_1"}:
        raise ValidationError(f"{name} must contain team_0 and team_1.")
    orders = []
    for team_key in ("team_0", "team_1"):
        order = value[team_key]
        if not isinstance(order, list) or any(type(slot) is not int for slot in order):
            raise ValidationError(f"{name}.{team_key} must be an array of player slots.")
        orders.append(tuple(order))
    return tuple(orders)  # type: ignore[return-value]


def _orders_to_firestore(value: tuple[tuple[int, ...], tuple[int, ...]]) -> dict[str, list[int]]:
    return {"team_0": list(value[0]), "team_1": list(value[1])}


def teams_from_firestore(value: Any) -> tuple[Team, Team]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValidationError("teams must contain exactly two teams.")
    teams = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"name", "players"}:
            raise ValidationError("Each team must contain only name and players.")
        if (
            not isinstance(item["name"], str)
            or not isinstance(item["players"], list)
            or not all(isinstance(player, str) for player in item["players"])
        ):
            raise ValidationError("Team names must be strings and players must be arrays.")
        try:
            teams.append(Team(item["name"], tuple(item["players"])))
        except (TypeError, ValueError) as exc:
            raise ValidationError(str(exc)) from exc
    return tuple(teams)  # type: ignore[return-value]


def teams_to_firestore(teams: tuple[Team, Team]) -> list[dict[str, Any]]:
    return [{"name": team.name, "players": list(team.players)} for team in teams]


def config_from_firestore(teams_value: Any, match_type_value: Any, value: Any) -> MatchConfig:
    if not isinstance(value, dict):
        raise ValidationError("config must be an object.")
    _exact_keys(value, CONFIG_FIELDS, "config", required=False)
    data = dict(value)
    for name in ("serving_orders", "receiving_orders"):
        if name in data:
            data[name] = _orders_from_firestore(data[name], name)
    try:
        return MatchConfig(
            teams=teams_from_firestore(teams_value),
            match_type=MatchType(match_type_value),
            **data,
        )
    except (TypeError, ValueError) as exc:
        raise ValidationError(str(exc)) from exc


def config_to_firestore(config: MatchConfig) -> dict[str, Any]:
    return {
        "no_ad": config.no_ad,
        "games_per_set": config.games_per_set,
        "tiebreak_at": config.tiebreak_at,
        "tiebreak_points": config.tiebreak_points,
        "deciding_tiebreak_points": config.deciding_tiebreak_points,
        "sets_to_win": config.sets_to_win,
        "starting_server_team": config.starting_server_team,
        "starting_server_player": config.starting_server_player,
        "serving_orders": _orders_to_firestore(config.serving_orders),
        "receiving_orders": _orders_to_firestore(config.receiving_orders),
    }


def _state_from_engine_data(value: Any, config: MatchConfig) -> MatchState:
    if not isinstance(value, dict):
        raise ValidationError("state must be an object.")
    _exact_keys(value, STATE_FIELDS, "state", required=True)
    data = dict(value)
    data["completed_sets"] = [tuple(_pair(item, "completed_sets item")) for item in data["completed_sets"]]
    try:
        data["status"] = MatchStatus(data["status"])
        state = MatchState(**data)
    except (TypeError, ValueError) as exc:
        raise ValidationError(str(exc)) from exc
    validate_state(state, config)
    return state


def state_to_firestore(state: MatchState) -> dict[str, Any]:
    data = state.to_dict()
    data["completed_sets"] = [
        {"team_0": score[0], "team_1": score[1]} for score in state.completed_sets
    ]
    return data


def state_from_firestore(value: Any, config: MatchConfig) -> MatchState:
    """Restore Firestore's map representation of completed set scores."""
    if not isinstance(value, dict):
        raise ValidationError("state must be an object.")
    converted = dict(value)
    completed_sets = converted.get("completed_sets")
    if not isinstance(completed_sets, list):
        raise ValidationError("completed_sets must be an array.")
    converted["completed_sets"] = []
    for score in completed_sets:
        if not isinstance(score, dict) or set(score) != {"team_0", "team_1"}:
            raise ValidationError("Each completed set must contain team_0 and team_1.")
        converted["completed_sets"].append([score["team_0"], score["team_1"]])
    return _state_from_engine_data(converted, config)


def state_from_engine_data(value: Any, config: MatchConfig) -> MatchState:
    """Validate state represented in the engine/API's ordinary list format."""
    return _state_from_engine_data(value, config)


def validate_state(state: MatchState, config: MatchConfig) -> None:
    for name in ("points", "games", "sets"):
        setattr(state, name, _pair(getattr(state, name), name))
    if not isinstance(state.completed_sets, list):
        raise ValidationError("completed_sets must be an array.")
    state.completed_sets = [tuple(_pair(score, "completed_sets item")) for score in state.completed_sets]

    for name in ("server_team", "receiver_team"):
        if getattr(state, name) not in (0, 1):
            raise ValidationError(f"{name} must be 0 or 1.")
    if state.receiver_team != 1 - state.server_team:
        raise ValidationError("receiver_team must be opposite server_team.")
    for team_name, player_name in (("server_team", "server_player"), ("receiver_team", "receiver_player")):
        team = getattr(state, team_name)
        player = getattr(state, player_name)
        if type(player) is not int or player not in range(len(config.teams[team].players)):
            raise ValidationError(f"{player_name} is not valid for {team_name}.")
    for name in ("game_number", "point_number"):
        if type(getattr(state, name)) is not int or getattr(state, name) < 0:
            raise ValidationError(f"{name} must be a non-negative integer.")
    if state.point_number != sum(state.points):
        raise ValidationError("point_number must equal the total current points.")
    if type(state.in_tiebreak) is not bool or type(state.umpire_requested) is not bool:
        raise ValidationError("in_tiebreak and umpire_requested must be booleans.")

    tiebreak_values = (state.tiebreak_initial_server_team, state.tiebreak_initial_server_player)
    if state.in_tiebreak and None in tiebreak_values:
        raise ValidationError("A tiebreak must identify its initial server.")
    if not state.in_tiebreak and any(value is not None for value in tiebreak_values):
        raise ValidationError("Tiebreak server fields must be null outside a tiebreak.")
    if state.in_tiebreak:
        initial_team = state.tiebreak_initial_server_team
        initial_player = state.tiebreak_initial_server_player
        if initial_team not in (0, 1) or initial_player not in range(len(config.teams[initial_team].players)):
            raise ValidationError("The tiebreak initial server is invalid.")

    if state.status == MatchStatus.COMPLETE:
        if type(state.winner_team) is not int or state.winner_team not in (0, 1):
            raise ValidationError("A completed match must have a winner_team.")
        if state.sets[state.winner_team] < config.sets_to_win:
            raise ValidationError("The winner has not won enough sets.")
    elif state.winner_team is not None:
        raise ValidationError("An in-progress match cannot have a winner_team.")
    if state.last_action is not None and not isinstance(state.last_action, str):
        raise ValidationError("last_action must be a string or null.")
