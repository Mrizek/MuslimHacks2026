from __future__ import annotations

from . import MatchConfig, MatchType, ScoringEngine, Team


HELP_TEXT = """
Commands:
  point 0              Give the next point to team 0
  point 1              Give the next point to team 1
  undo                 Undo the latest action
  umpire               Request an umpire
  clear-umpire         Clear the umpire request
  override games 4 3   Set current games to 4-3
  override points 3 3  Set raw points to 3-3, displayed as 40-40
  show                 Print the current scoreboard
  help                 Show commands
  quit                 Exit
""".strip()


def build_default_doubles_match() -> ScoringEngine:
    return ScoringEngine(
        MatchConfig(
            teams=(
                Team("Tremblay/Roy", ("J. Tremblay", "A. Roy")),
                Team("Dubois/Lefebvre", ("M. Dubois", "P. Lefebvre")),
            ),
            match_type=MatchType.DOUBLES,
            no_ad=False,
            serving_orders=((0, 1), (0, 1)),
            receiving_orders=((0, 1), (0, 1)),
            tiebreak_points=7,
        )
    )


def print_score(engine: ScoringEngine) -> None:
    score = engine.display_score()
    print()
    print(f"Points: {score['points'][0]} - {score['points'][1]}")
    print(f"Games:  {score['games'][0]} - {score['games'][1]}")
    print(f"Sets:   {score['sets'][0]} - {score['sets'][1]}")
    print(f"Server: {score['server']}")
    print(f"Receiver: {score['receiver']}")
    print(f"Tiebreak: {score['in_tiebreak']}")
    print(f"Umpire requested: {score['umpire_requested']}")
    print(f"Status: {score['status']}")
    if score["winner"]:
        print(f"Winner: {score['winner']}")
    print()


def run_interactive_match() -> None:
    engine = build_default_doubles_match()
    print("Started a default doubles match.")
    print(HELP_TEXT)
    print_score(engine)

    while True:
        command = input("match> ").strip().lower()
        if command in ("quit", "exit", "q"):
            return
        if command == "help":
            print(HELP_TEXT)
            continue
        if command == "show":
            print_score(engine)
            continue

        try:
            if command.startswith("point "):
                engine.score_point(int(command.split()[1]))
            elif command == "undo":
                engine.undo()
            elif command == "umpire":
                engine.request_umpire()
            elif command == "clear-umpire":
                engine.clear_umpire_request()
            elif command.startswith("override games "):
                _, _, left, right = command.split()
                engine.override(games=[int(left), int(right)])
            elif command.startswith("override points "):
                _, _, left, right = command.split()
                engine.override(points=[int(left), int(right)])
            else:
                print("Unknown command. Type 'help' for options.")
                continue
        except (ValueError, IndexError, RuntimeError, AttributeError) as error:
            print(f"Could not apply command: {error}")
            continue

        print_score(engine)
