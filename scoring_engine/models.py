from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class MatchType(str, Enum):
    """The engine supports the two formats needed by the hackathon brief."""

    SINGLES = "singles"
    DOUBLES = "doubles"


class MatchStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"


@dataclass(frozen=True)
class Team:
    """A tennis team.

    In singles, a team has one player. In doubles, a team has two players.
    The engine always refers to teams by index: team 0 or team 1.
    """

    name: str
    players: tuple[str, ...]

    def __post_init__(self) -> None:
        if len(self.players) not in (1, 2):
            raise ValueError("A team must have one player for singles or two players for doubles.")


@dataclass(frozen=True)
class MatchConfig:
    """Rules and starting setup for a match.

    Tennis score hierarchy:
    - points build up to win one game
    - games build up to win one set
    - sets build up to win the match

    The order fields use player slots, not names. For a doubles team
    ("A1", "A2"), player slot 0 is A1 and player slot 1 is A2.
    """

    teams: tuple[Team, Team]
    match_type: MatchType = MatchType.SINGLES
    # No-Ad means a game at 40-40 is decided by the next point.
    # Normal tennis requires a two-point margin after 40-40.
    no_ad: bool = False
    # Standard sets are usually first to 6 games, win by 2 games.
    games_per_set: int = 6
    # At 6-6, most formats play a tiebreak instead of continuing games forever.
    tiebreak_at: int = 6
    # A normal set tiebreak is commonly first to 7, win by 2.
    # Some event formats use first to 10, win by 2.
    tiebreak_points: int = 7
    # Optional special tiebreak length for the final/deciding set.
    deciding_tiebreak_points: int | None = None
    sets_to_win: int = 1
    starting_server_team: int = 0
    starting_server_player: int = 0
    # Doubles service order is explicit so the UI can show who serves next.
    serving_orders: tuple[tuple[int, ...], tuple[int, ...]] = ((0,), (0,))
    # Doubles receiving order is explicit because partners receive from
    # different sides of the court and that matters during tiebreaks.
    receiving_orders: tuple[tuple[int, ...], tuple[int, ...]] = ((0,), (0,))

    def __post_init__(self) -> None:
        if len(self.teams) != 2:
            raise ValueError("Exactly two teams are required.")
        if self.match_type == MatchType.SINGLES:
            expected_slots = (0,)
        else:
            expected_slots = (0, 1)

        for team in self.teams:
            if self.match_type == MatchType.SINGLES and len(team.players) != 1:
                raise ValueError("Singles teams must have exactly one player.")
            if self.match_type == MatchType.DOUBLES and len(team.players) != 2:
                raise ValueError("Doubles teams must have exactly two players.")

        for order in (*self.serving_orders, *self.receiving_orders):
            if tuple(sorted(order)) != expected_slots:
                raise ValueError("Serving and receiving orders must list each player slot once.")

        if self.tiebreak_points not in (7, 10):
            raise ValueError("Tiebreaks must be configured as 7 or 10 points.")
        if self.deciding_tiebreak_points is not None and self.deciding_tiebreak_points not in (7, 10):
            raise ValueError("Deciding tiebreaks must be configured as 7 or 10 points.")


@dataclass
class MatchState:
    """Current scoreboard state.

    Raw point numbers are stored as counts: 0, 1, 2, 3...
    display_score() converts them to tennis labels: 0, 15, 30, 40, AD.
    """

    points: list[int] = field(default_factory=lambda: [0, 0])
    games: list[int] = field(default_factory=lambda: [0, 0])
    sets: list[int] = field(default_factory=lambda: [0, 0])
    completed_sets: list[tuple[int, int]] = field(default_factory=list)
    server_team: int = 0
    server_player: int = 0
    receiver_team: int = 1
    receiver_player: int = 0
    game_number: int = 0
    point_number: int = 0
    in_tiebreak: bool = False
    tiebreak_initial_server_team: int | None = None
    tiebreak_initial_server_player: int | None = None
    umpire_requested: bool = False
    status: MatchStatus = MatchStatus.IN_PROGRESS
    winner_team: int | None = None
    last_action: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "points": self.points,
            "games": self.games,
            "sets": self.sets,
            "completed_sets": self.completed_sets,
            "server_team": self.server_team,
            "server_player": self.server_player,
            "receiver_team": self.receiver_team,
            "receiver_player": self.receiver_player,
            "game_number": self.game_number,
            "point_number": self.point_number,
            "in_tiebreak": self.in_tiebreak,
            "umpire_requested": self.umpire_requested,
            "status": self.status.value,
            "winner_team": self.winner_team,
            "last_action": self.last_action,
        }
