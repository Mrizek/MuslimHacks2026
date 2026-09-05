from __future__ import annotations

from copy import deepcopy
from typing import Any

from .types import MatchConfig, MatchState, MatchStatus


POINT_LABELS = ("0", "15", "30", "40")


class ScoringEngine:
    """Pure tennis scoring engine suitable for Django services and UI tests.

    This class deliberately has no database, WebSocket, or UI code. Django can
    call it when a court tablet sends an action, then save the returned state.
    """

    def __init__(self, config: MatchConfig, state: MatchState | None = None) -> None:
        self.config = config
        self.state = state or self._initial_state()
        self._history: list[MatchState] = []

    @property
    def history_count(self) -> int:
        return len(self._history)

    def score_point(self, winner_team: int) -> MatchState:
        """Give one point to team 0 or team 1 and update the match.

        Tennis scoring is unusual:
        - 0 points is displayed as "0"
        - 1 point is displayed as "15"
        - 2 points is displayed as "30"
        - 3 points is displayed as "40"
        - after 40-40, normal tennis needs a two-point lead to win the game
        - in No-Ad mode, the next point after 40-40 wins the game
        """
        self._assert_team(winner_team)
        self._assert_in_progress()
        self._remember("point")

        self.state.points[winner_team] += 1
        self.state.point_number += 1

        if self.state.in_tiebreak:
            if self._has_won_tiebreak(winner_team):
                self._win_game(winner_team)
            else:
                self._refresh_tiebreak_server_receiver()
        elif self._has_won_standard_game(winner_team):
            self._win_game(winner_team)
        else:
            self._refresh_receiver()

        self.state.last_action = f"point_to_team_{winner_team}"
        return self.state

    def request_umpire(self) -> MatchState:
        """Flag that players need a human decision for a dispute."""
        self._assert_in_progress()
        self._remember("umpire_request")
        self.state.umpire_requested = True
        self.state.last_action = "umpire_requested"
        return self.state

    def clear_umpire_request(self) -> MatchState:
        """Clear the dispute flag after an organizer or umpire responds."""
        self._remember("umpire_clear")
        self.state.umpire_requested = False
        self.state.last_action = "umpire_request_cleared"
        return self.state

    def override(self, **changes: Any) -> MatchState:
        """Organizer override for explicit state corrections.

        Example: engine.override(games=[4, 3], server_team=1, server_player=0)

        This is intentionally flexible because real tournaments need quick
        corrections when players report a mistake or voice recognition mishears.
        """
        self._remember("override")
        for key, value in changes.items():
            if not hasattr(self.state, key):
                raise AttributeError(f"Unknown match state field: {key}")
            setattr(self.state, key, deepcopy(value))
        self._refresh_receiver()
        self.state.last_action = "organizer_override"
        return self.state

    def undo(self) -> MatchState:
        """Undo the latest scoring action, umpire flag change, or override."""
        if not self._history:
            raise IndexError("No scoring actions to undo.")
        self.state = self._history.pop()
        return self.state

    def display_score(self) -> dict[str, Any]:
        """Return UI-friendly score labels and player names.

        The internal state stores points as numbers because numbers are easier
        to calculate with. This method translates them into tennis terms.
        """
        points = self.state.points
        if self.state.in_tiebreak:
            point_text = [str(points[0]), str(points[1])]
        elif points[0] >= 3 and points[1] >= 3:
            if points[0] == points[1]:
                point_text = ["40", "40"]
            elif points[0] > points[1]:
                point_text = ["AD", "40"]
            else:
                point_text = ["40", "AD"]
        else:
            point_text = [POINT_LABELS[min(points[0], 3)], POINT_LABELS[min(points[1], 3)]]

        return {
            "points": point_text,
            "games": list(self.state.games),
            "sets": list(self.state.sets),
            "completed_sets": list(self.state.completed_sets),
            "server": self._player_name(self.state.server_team, self.state.server_player),
            "receiver": self._player_name(self.state.receiver_team, self.state.receiver_player),
            "in_tiebreak": self.state.in_tiebreak,
            "umpire_requested": self.state.umpire_requested,
            "status": self.state.status.value,
            "winner": None
            if self.state.winner_team is None
            else self.config.teams[self.state.winner_team].name,
        }

    def _initial_state(self) -> MatchState:
        server_team = self.config.starting_server_team
        server_player = self.config.starting_server_player
        state = MatchState(
            server_team=server_team,
            server_player=server_player,
            receiver_team=1 - server_team,
            game_number=0,
        )
        state.receiver_player = self._receiver_for_current_point(state)
        return state

    def _remember(self, action: str) -> None:
        # Keep a full snapshot before every change. This makes undo simple and
        # reliable, and it is fast enough for a match-scoring tablet.
        snapshot = deepcopy(self.state)
        snapshot.last_action = action
        self._history.append(snapshot)

    def _win_game(self, winner_team: int) -> None:
        # Winning a game resets points to 0-0 and may also finish a set.
        self.state.games[winner_team] += 1
        self.state.points = [0, 0]
        self.state.point_number = 0
        self.state.in_tiebreak = False
        self.state.tiebreak_initial_server_team = None
        self.state.tiebreak_initial_server_player = None

        if self._has_won_set(winner_team):
            self._win_set(winner_team)

        if self.state.status == MatchStatus.IN_PROGRESS:
            self.state.game_number += 1
            self._advance_regular_server()
            if self._should_start_tiebreak():
                # At 6-6, switch to tiebreak scoring. We remember who starts
                # serving because tiebreak service rotation has special rules.
                self.state.in_tiebreak = True
                self.state.tiebreak_initial_server_team = self.state.server_team
                self.state.tiebreak_initial_server_player = self.state.server_player
            self._refresh_receiver()

    def _win_set(self, winner_team: int) -> None:
        # Store the completed set score, then reset games for the next set.
        self.state.sets[winner_team] += 1
        self.state.completed_sets.append((self.state.games[0], self.state.games[1]))
        self.state.games = [0, 0]

        if self.state.sets[winner_team] >= self.config.sets_to_win:
            self.state.status = MatchStatus.COMPLETE
            self.state.winner_team = winner_team

    def _has_won_standard_game(self, team: int) -> bool:
        # Normal game: first to at least 4 raw points with a 2-point margin.
        # No-Ad game: first to 4 raw points wins, even from 40-40.
        own = self.state.points[team]
        other = self.state.points[1 - team]
        if self.config.no_ad:
            return own >= 4
        return own >= 4 and own - other >= 2

    def _has_won_tiebreak(self, team: int) -> bool:
        # Tiebreaks are first to 7 or 10, but still require a 2-point margin.
        target = self._current_tiebreak_target()
        own = self.state.points[team]
        other = self.state.points[1 - team]
        return own >= target and own - other >= 2

    def _has_won_set(self, team: int) -> bool:
        # Standard set: first to 6 games with a 2-game margin.
        # Tiebreak set: a 7-6 set score is allowed after a 6-6 tiebreak.
        own = self.state.games[team]
        other = self.state.games[1 - team]
        if own == self.config.tiebreak_at + 1 and other == self.config.tiebreak_at:
            return True
        return own >= self.config.games_per_set and own - other >= 2

    def _should_start_tiebreak(self) -> bool:
        return self.state.games == [self.config.tiebreak_at, self.config.tiebreak_at]

    def _current_tiebreak_target(self) -> int:
        is_deciding = sum(self.state.sets) == (self.config.sets_to_win * 2 - 2)
        if is_deciding and self.config.deciding_tiebreak_points is not None:
            return self.config.deciding_tiebreak_points
        return self.config.tiebreak_points

    def _advance_regular_server(self) -> None:
        # Service alternates teams every game. In doubles, each team also
        # alternates between its two players according to serving_orders.
        next_team = 1 - self.state.server_team
        service_game_index = self.state.game_number // 2
        next_order = self.config.serving_orders[next_team]
        self.state.server_team = next_team
        self.state.server_player = next_order[service_game_index % len(next_order)]

    def _refresh_receiver(self) -> None:
        # The receiver is always on the opposite team from the server.
        self.state.receiver_team = 1 - self.state.server_team
        self.state.receiver_player = self._receiver_for_current_point(self.state)

    def _refresh_tiebreak_server_receiver(self) -> None:
        server_team, server_player = self._tiebreak_server_for_point(self.state.point_number)
        self.state.server_team = server_team
        self.state.server_player = server_player
        self._refresh_receiver()

    def _tiebreak_server_for_point(self, next_point_number: int) -> tuple[int, int]:
        # Tiebreak service pattern:
        # - the first server serves 1 point
        # - after that, players serve 2 points each
        # Example point servers: A, B, B, A, A, B, B...
        if next_point_number == 0:
            return self.state.server_team, self.state.server_player

        service_turn = (next_point_number + 1) // 2
        team = self.state.tiebreak_initial_server_team
        player = self.state.tiebreak_initial_server_player
        if team is None or player is None:
            team = self.state.server_team
            player = self.state.server_player

        server_team = team
        server_player = player
        game_number = self.state.game_number
        for _ in range(service_turn):
            server_team = 1 - server_team
            game_number += 1
            order = self.config.serving_orders[server_team]
            server_player = order[(game_number // 2) % len(order)]
        return server_team, server_player

    def _receiver_for_current_point(self, state: MatchState) -> int:
        # In doubles, receivers alternate by point side. Tracking this
        # explicitly avoids guessing during tiebreaks and voice corrections.
        order = self.config.receiving_orders[state.receiver_team]
        if len(order) == 1:
            return order[0]
        side_index = state.point_number % 2
        return order[side_index]

    def _player_name(self, team_index: int, player_index: int) -> str:
        return self.config.teams[team_index].players[player_index]

    def _assert_team(self, team: int) -> None:
        if team not in (0, 1):
            raise ValueError("Team index must be 0 or 1.")

    def _assert_in_progress(self) -> None:
        if self.state.status != MatchStatus.IN_PROGRESS:
            raise RuntimeError("Cannot score a completed match.")
