# CourtSide AI Backend

CourtSide AI is a Django ASGI backend for live tennis scoring. The pure Python
engine in `scoring_engine/` stays independent of Django, Firebase, and Channels.
Django validates commands, persists canonical match state in Cloud Firestore,
and broadcasts committed updates to match and organizer WebSocket groups.

## What is included

- Tennis points, games, sets, No-Ad, singles/doubles rotations, and 7/10-point tiebreaks
- Firestore adapters for teams, enums, tuples, doubles orders, and completed sets
- REST endpoints for courts, matches, and health checks
- Match-specific and dashboard WebSockets using Django Channels
- Firestore transactions for atomic match persistence
- An in-memory channel layer for a single-process hackathon demo
- Automated engine, REST, service, concurrency, and WebSocket tests

Undo remains available on an in-memory `ScoringEngine`, but there is deliberately
no backend undo endpoint or persistent action-history collection.

## Install on Windows PowerShell

```powershell
cd C:\Users\rayan\OneDrive\Bureau\muslimhacks\MuslimHacks2026
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Django reads environment variables from the shell; it does not automatically
load `.env`. For local emulators, set them in the current PowerShell session:

```powershell
$env:DJANGO_SECRET_KEY = "local-demo-only"
$env:FIREBASE_PROJECT_ID = "courtside-ai-demo"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
firebase emulators:start --only auth,firestore --project courtside-ai-demo
```

Firebase CLI 15 requires JDK 21 or newer for its local emulators.

In another activated terminal, start exactly one ASGI process:

```powershell
daphne -b 127.0.0.1 -p 8000 courtside_backend.asgi:application
```

`python manage.py runserver` also works for local development. Do not add worker
processes while using `InMemoryChannelLayer`; separate processes do not share its
messages. A production multi-worker setup would require a shared channel layer.

For deployed Firebase, omit both emulator variables and set
`GOOGLE_APPLICATION_CREDENTIALS` to a service-account file outside this repo, or
use Application Default Credentials. Credentials must never be committed.

## Tests

Normal tests use an atomic in-memory repository and require no Firebase project
or production credentials:

```powershell
python -B manage.py test tests -v 2
python -B manage.py check
```

The normal run skips one optional emulator integration test. With the Firestore
emulator active, run it explicitly:

```powershell
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_PROJECT_ID = "courtside-ai-demo"
python -B manage.py test tests.test_firestore_emulator -v 2
```

On Windows, the same check can be run with Firebase managing emulator startup:

```powershell
firebase emulators:exec --only firestore --project courtside-ai-demo tests\run_firestore_emulator_test.cmd
```

The standalone manual match runner remains under `tests/`:

```powershell
python -B tests\interactive_match.py
```

## Local demo access

Authentication is temporarily disabled for the court and match REST endpoints
and for both WebSocket endpoints. Postman requests do not need an Authorization
header. This is intended only for local testing.

Anyone who can reach the REST API can create and retrieve courts and matches.
Anyone who can reach `/ws/matches/{match_id}/` can read that match and invoke its
supported scoring, umpire, and override commands. Anyone who can reach
`/ws/dashboard/` can read all dashboard match data and receive updates.

Firebase Admin credentials are still required by Django to access Firestore.
The Admin SDK bypasses client rules; `firestore.rules` continues to deny direct
client access.

## REST API

- `GET /api/health/`
- `POST /api/courts/`
- `GET /api/courts/`
- `POST /api/matches/`
- `GET /api/matches/`
- `GET /api/matches/{match_id}/`

Example match creation body:

```json
{
  "court_id": "COURT_DOCUMENT_ID",
  "teams": [
    {"name": "North", "players": ["Nadia", "Noor"]},
    {"name": "South", "players": ["Sami", "Sara"]}
  ],
  "match_type": "doubles",
  "config": {
    "no_ad": true,
    "sets_to_win": 1,
    "tiebreak_points": 7,
    "deciding_tiebreak_points": 10,
    "starting_server_team": 0,
    "starting_server_player": 0,
    "serving_orders": {"team_0": [0, 1], "team_1": [0, 1]},
    "receiving_orders": {"team_0": [1, 0], "team_1": [0, 1]}
  }
}
```

Omitted config values use engine defaults. Responses include the raw engine
`state` and a computed `display_score`. Display values are never duplicated in
Firestore.

## WebSocket API

Connect to `/ws/matches/{match_id}/` for one match or `/ws/dashboard/` for
updates. The server subscribes the connection and immediately sends a
`match_snapshot`; no authentication message is required.

Score a point:

```json
{
  "type": "score_point",
  "action_id": "3d9c7358-3dea-47e8-bf04-7d772a83eb36",
  "payload": {"winner_team": 0}
}
```

Other commands use the same envelope:

```json
{"type":"request_umpire","action_id":"UUID","payload":{}}
{"type":"clear_umpire_request","action_id":"UUID","payload":{}}
{"type":"override","action_id":"UUID","payload":{"changes":{"games":[4,3]}}}
{"type":"get_state","action_id":"UUID"}
```

The server sends `action_ack` only after persistence commits, broadcasts
`match_updated` to the match and dashboard groups, and uses `error` for invalid,
unauthorized, or failed commands. State messages contain `match_id`; command
responses contain `action_id`.

## Frontend integration

Keep the latest received snapshot or update in app state. On reconnect, request
the saved state before sending another command.
`action_id` correlates responses only; it is not a persistent command receipt.

Treat validation errors as client bugs or bad input, and persistence errors as
uncertain operations that require reconnecting or retrieving state before
another command.
