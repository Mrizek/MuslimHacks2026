# MuslimHacks 2026 - Person 2 Scoring Engine

This repository contains a standalone tennis scoring engine for the CourtSide AI challenge. It is intentionally UI-independent so the Django backend can own match state while React Native or Flutter clients render the scoreboard and controls.

## Covered

- Points, games, sets, deuce, advantage, and No-Ad scoring
- Singles and doubles serving order
- Explicit doubles receiving order
- 7-point and 10-point tiebreaks
- Action history with undo
- Organizer overrides
- Umpire-request flag
- Independent unit tests for scoring transitions and rotations

## Run Tests

```bash
python -m unittest discover -s tests
```

You can also run the test file directly from your IDE or terminal:

```bash
python tests/test_scoring_engine.py
```

## Manual Match Tester

To start a match and type your own scoring commands:

```bash
python tests/interactive_match.py
```

Or run the interactive tester from the test file:

```bash
python tests/test_scoring_engine.py --interactive-match
```

Useful commands:

```text
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
```

## Example

```python
from scoring_engine import MatchConfig, MatchType, ScoringEngine, Team

engine = ScoringEngine(
    MatchConfig(
        teams=(Team("Tremblay/Roy", ("J. Tremblay", "A. Roy")), Team("Dubois/Lefebvre", ("M. Dubois", "P. Lefebvre"))),
        match_type=MatchType.DOUBLES,
        no_ad=True,
        serving_orders=((0, 1), (0, 1)),
        receiving_orders=((0, 1), (1, 0)),
        tiebreak_points=10,
    )
)

engine.score_point(0)
engine.request_umpire()
print(engine.display_score())
```
