from pathlib import Path
import sys
import unittest

# When this file is run directly from an IDE, Python puts /tests on sys.path
# instead of the project root. Adding the root keeps `import scoring_engine`
# working both from the IDE and from `python -m unittest`.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scoring_engine import MatchConfig, MatchStatus, MatchType, ScoringEngine, Team
from scoring_engine.interactive import run_interactive_match


class ScoringEngineTests(unittest.TestCase):
    def singles_engine(self, **config):
        return ScoringEngine(
            MatchConfig(
                teams=(Team("A", ("A1",)), Team("B", ("B1",))),
                match_type=MatchType.SINGLES,
                **config,
            )
        )

    def doubles_engine(self, **config):
        defaults = {
            "serving_orders": ((0, 1), (0, 1)),
            "receiving_orders": ((1, 0), (0, 1)),
        }
        defaults.update(config)
        return ScoringEngine(
            MatchConfig(
                teams=(Team("A", ("A1", "A2")), Team("B", ("B1", "B2"))),
                match_type=MatchType.DOUBLES,
                **defaults,
            )
        )

    def win_game(self, engine, team):
        """Give one team four straight points, enough to win a simple game."""
        for _ in range(4):
            engine.score_point(team)

    def apply_commands(self, engine, commands):
        """Small scenario runner for tests.

        Commands are intentionally similar to what a voice or tablet UI sends:
        - "point 0" means team 0 won the point
        - "point 1" means team 1 won the point
        - "undo" rolls back the previous action
        - "umpire" flags that a human decision is needed
        - "override games 4 3" lets the organizer correct the scoreboard
        """
        for command in commands:
            parts = command.split()
            if parts[0] == "point":
                engine.score_point(int(parts[1]))
            elif command == "undo":
                engine.undo()
            elif command == "umpire":
                engine.request_umpire()
            elif parts[:2] == ["override", "games"]:
                engine.override(games=[int(parts[2]), int(parts[3])])
            else:
                raise ValueError(f"Unknown test command: {command}")

    def test_standard_game_requires_two_point_margin_after_deuce(self):
        engine = self.singles_engine()

        for winner in [0, 0, 0, 1, 1, 1]:
            engine.score_point(winner)
        self.assertEqual(engine.display_score()["points"], ["40", "40"])

        engine.score_point(0)
        self.assertEqual(engine.display_score()["points"], ["AD", "40"])
        engine.score_point(1)
        self.assertEqual(engine.display_score()["points"], ["40", "40"])
        engine.score_point(0)
        engine.score_point(0)

        self.assertEqual(engine.state.games, [1, 0])

    def test_no_ad_game_ends_on_next_point_at_deuce(self):
        engine = self.singles_engine(no_ad=True)

        for winner in [0, 0, 0, 1, 1, 1]:
            engine.score_point(winner)
        engine.score_point(1)

        self.assertEqual(engine.state.games, [0, 1])
        self.assertEqual(engine.state.points, [0, 0])

    def test_set_completes_at_six_games_with_two_game_margin(self):
        engine = self.singles_engine()

        for _ in range(6):
            self.win_game(engine, 0)

        self.assertEqual(engine.state.completed_sets, [(6, 0)])
        self.assertEqual(engine.state.sets, [1, 0])
        self.assertEqual(engine.state.status, MatchStatus.COMPLETE)
        self.assertEqual(engine.state.winner_team, 0)

    def test_seven_point_tiebreak_starts_at_six_all_and_wins_set(self):
        engine = self.singles_engine(tiebreak_points=7)

        for _ in range(6):
            self.win_game(engine, 0)
            self.win_game(engine, 1)

        self.assertTrue(engine.state.in_tiebreak)
        for _ in range(7):
            engine.score_point(0)

        self.assertEqual(engine.state.completed_sets, [(7, 6)])
        self.assertEqual(engine.state.sets, [1, 0])
        self.assertEqual(engine.state.status, MatchStatus.COMPLETE)

    def test_ten_point_tiebreak_requires_two_point_margin(self):
        engine = self.singles_engine(tiebreak_points=10)

        for _ in range(6):
            self.win_game(engine, 0)
            self.win_game(engine, 1)
        for winner in ([0] * 9) + ([1] * 9):
            engine.score_point(winner)

        engine.score_point(0)
        self.assertEqual(engine.state.points, [10, 9])
        engine.score_point(0)

        self.assertEqual(engine.state.completed_sets, [(7, 6)])

    def test_doubles_serving_order_rotates_by_team_and_player(self):
        engine = self.doubles_engine()

        self.assertEqual(engine.display_score()["server"], "A1")
        self.win_game(engine, 0)
        self.assertEqual(engine.display_score()["server"], "B1")
        self.win_game(engine, 0)
        self.assertEqual(engine.display_score()["server"], "A2")
        self.win_game(engine, 0)
        self.assertEqual(engine.display_score()["server"], "B2")

    def test_doubles_receiving_order_is_explicit_and_alternates_by_point_side(self):
        engine = self.doubles_engine()

        self.assertEqual(engine.display_score()["receiver"], "B1")
        engine.score_point(0)
        self.assertEqual(engine.display_score()["receiver"], "B2")
        engine.score_point(1)
        self.assertEqual(engine.display_score()["receiver"], "B1")

        engine = self.doubles_engine()
        self.win_game(engine, 0)
        self.assertEqual(engine.display_score()["server"], "B1")
        self.assertEqual(engine.display_score()["receiver"], "A2")

    def test_undo_restores_previous_state(self):
        engine = self.singles_engine()

        engine.score_point(0)
        engine.score_point(0)
        self.assertEqual(engine.display_score()["points"], ["30", "0"])
        engine.undo()

        self.assertEqual(engine.display_score()["points"], ["15", "0"])
        self.assertEqual(engine.history_count, 1)

    def test_override_and_umpire_request_are_historical_actions(self):
        engine = self.doubles_engine()

        engine.override(games=[4, 3], server_team=1, server_player=0)
        self.assertEqual(engine.state.games, [4, 3])
        self.assertEqual(engine.display_score()["server"], "B1")

        engine.request_umpire()
        self.assertTrue(engine.state.umpire_requested)
        engine.undo()
        self.assertFalse(engine.state.umpire_requested)
        engine.undo()
        self.assertEqual(engine.state.games, [0, 0])

    def test_match_can_be_driven_by_a_command_scenario(self):
        engine = self.doubles_engine()

        scenario = [
            "point 0",
            "point 0",
            "point 1",
            "undo",
            "point 0",
            "point 0",
            "override games 4 3",
            "umpire",
        ]
        self.apply_commands(engine, scenario)

        self.assertEqual(engine.state.games, [4, 3])
        self.assertEqual(engine.display_score()["points"], ["0", "0"])
        self.assertTrue(engine.state.umpire_requested)


if __name__ == "__main__":
    if "--interactive-match" in sys.argv:
        run_interactive_match()
    else:
        unittest.main()
