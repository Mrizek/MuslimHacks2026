# CourtSide AI Backend

Django, Firestore, and WebSocket backend for the CourtSide AI tennis-scoring
demo. The standalone engine handles points, games, sets, No-Ad, doubles player
order, tiebreaks, overrides, and umpire requests.

## Setup

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
```

Create `.env` in the project root:

```dotenv
DJANGO_SECRET_KEY=local-demo-only
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=D:\path\to\firebase-service-account.json
```

Settings loads this file automatically with `python-dotenv`. Keep the service
account file outside the repository and never commit it.

Start one ASGI server process:

```powershell
python -B -m daphne -b 127.0.0.1 -p 8000 courtside_backend.asgi:application
```

Health check: `http://127.0.0.1:8000/api/health/`

Interactive Swagger UI: `http://127.0.0.1:8000/api/docs/`

Use **Try it out** in Swagger to run the court and match GET/POST requests. The
OpenAPI JSON is available at `http://127.0.0.1:8000/api/schema/` and can be
imported into SwaggerHub.

## Create a Match

No Authorization header is needed for this local demo.

First, create a court in Postman:

```http
POST http://127.0.0.1:8000/api/courts/
Content-Type: application/json
```

```json
{"name":"Court 1"}
```

Copy the returned `id`, then create a match.

Singles example, with one player on each team:

```http
POST http://127.0.0.1:8000/api/matches/
Content-Type: application/json
```

```json
{
  "court_id": "PASTE_COURT_ID_HERE",
  "teams": [
    {"name": "Team North", "players": ["Nadia"]},
    {"name": "Team South", "players": ["Sami"]}
  ],
  "match_type": "singles",
  "config": {
    "no_ad": false,
    "games_per_set": 6,
    "tiebreak_at": 6,
    "tiebreak_points": 7,
    "sets_to_win": 1,
    "starting_server_team": 0,
    "starting_server_player": 0,
    "serving_orders": {"team_0": [0], "team_1": [0]},
    "receiving_orders": {"team_0": [0], "team_1": [0]}
  }
}
```

Doubles example, with two players on each team:

```http
POST http://127.0.0.1:8000/api/matches/
Content-Type: application/json
```

```json
{
  "court_id": "PASTE_COURT_ID_HERE",
  "teams": [
    {"name": "Team North", "players": ["Nadia", "Noor"]},
    {"name": "Team South", "players": ["Sami", "Sara"]}
  ],
  "match_type": "doubles",
  "config": {
    "no_ad": false,
    "games_per_set": 6,
    "tiebreak_at": 6,
    "tiebreak_points": 7,
    "sets_to_win": 2,
    "starting_server_team": 0,
    "starting_server_player": 1,
    "serving_orders": {"team_0": [1, 0], "team_1": [0, 1]},
    "receiving_orders": {"team_0": [0, 1], "team_1": [1, 0]}
  }
}
```

Copy the returned `match_id`. You can retrieve it with:

```http
GET http://127.0.0.1:8000/api/matches/PASTE_MATCH_ID_HERE/
```

Delete one match:

```http
DELETE http://127.0.0.1:8000/api/matches/PASTE_MATCH_ID_HERE/
```

Delete a court and all matches on that court:

```http
DELETE http://127.0.0.1:8000/api/courts/PASTE_COURT_ID_HERE/
```

## Match Config Options

All config fields are optional inside the `config` object. If a field is
omitted, the backend uses the default shown here.

| Field | Default | Allowed values | Description |
| --- | --- | --- | --- |
| `no_ad` | `false` | `true` or `false` | If `true`, the next point wins the game at 40-40. |
| `games_per_set` | `6` | integer `>= 1` | Games needed to win a set, still requiring a two-game margin unless a tiebreak is reached. |
| `tiebreak_at` | `6` | integer `>= games_per_set` | Starts a tiebreak when the set score reaches this value for both teams. |
| `tiebreak_points` | `7` | `7` or `10` | Points needed to win a normal tiebreak, with a two-point margin. |
| `sets_to_win` | `1` | integer `>= 1` | Sets needed to win the match. |
| `starting_server_team` | `0` | `0` or `1` | Team that serves first. |
| `starting_server_player` | `0` | valid player slot | Player slot that serves first: singles uses `0`; doubles uses `0` or `1`. |
| `serving_orders` | `{"team_0":[0],"team_1":[0]}` | each team lists every player slot once | Service order per team. Singles uses `[0]`; doubles uses `[0,1]` or `[1,0]`. |
| `receiving_orders` | `{"team_0":[0],"team_1":[0]}` | each team lists every player slot once | Receiving order per team. Singles uses `[0]`; doubles uses `[0,1]` or `[1,0]`. |

## Open a Match WebSocket

Use Postman instead of the browser developer tools:

1. Start the backend with Daphne.
2. In Postman, select **New** then **WebSocket**.
3. Enter `ws://127.0.0.1:8000/ws/matches/PASTE_MATCH_ID_HERE/`.
4. Click **Connect**.
5. Postman immediately receives a `match_snapshot` message.
6. Paste one of the JSON commands below into the **Message** box and click
   **Send**.

Each command needs a fresh UUID string in `action_id`. A successful mutating
command sends `action_ack`, followed by `match_updated` to every client watching
that match.

## Match WebSocket Commands

Score a point for team `0` or team `1`:

```json
{
  "type": "score_point",
  "action_id": "11111111-1111-4111-8111-111111111111",
  "payload": {"winner_team": 0}
}
```

Ask for an umpire:

```json
{
  "type": "request_umpire",
  "action_id": "22222222-2222-4222-8222-222222222222",
  "payload": {}
}
```

Clear the umpire request:

```json
{
  "type": "clear_umpire_request",
  "action_id": "33333333-3333-4333-8333-333333333333",
  "payload": {}
}
```

Undo the latest saved action:

```json
{
  "type": "undo",
  "action_id": "44444444-4444-4444-8444-444444444444",
  "payload": {}
}
```

Override match state:

```json
{
  "type": "override",
  "action_id": "55555555-5555-4555-8555-555555555555",
  "payload": {
    "changes": {
      "games": [4, 3],
      "points": [3, 2],
      "point_number": 5,
      "server_team": 1,
      "server_player": 0
    }
  }
}
```

Read the latest match state:

```json
{
  "type": "get_state",
  "action_id": "66666666-6666-4666-8666-666666666666"
}
```

Override changes may include these state fields: `points`, `games`, `sets`,
`completed_sets`, `server_team`, `server_player`, `receiver_team`,
`receiver_player`, `game_number`, `point_number`, `in_tiebreak`,
`tiebreak_initial_server_team`, `tiebreak_initial_server_player`,
`umpire_requested`, `status`, and `winner_team`. The backend validates the full
state after applying the override.

## Interactive WebSocket Commands

The match WebSocket also accepts these raw text commands in Postman. Paste one
line into the WebSocket **Message** box and click **Send**:

```text
point 0              Give the next point to team 0
point 1              Give the next point to team 1
undo                 Undo the latest action
umpire               Request an umpire
clear-umpire         Clear the umpire request
override games 4 3   Set current games to 4-3
override points 3 3  Set raw points to 3-3, displayed as 40-40
show                 Print the current scoreboard
```

For raw text commands, the backend generates the `action_id`. Mutating commands
return `action_ack` and then `match_updated`; `show` returns a `match_snapshot`.

## Dashboard WebSocket

Dashboard clients connect in Postman to:

```text
ws://127.0.0.1:8000/ws/dashboard/
```

The dashboard socket immediately receives all match snapshots and receives
`match_updated` whenever any match changes. It supports only `get_state`:

```json
{
  "type": "get_state",
  "action_id": "77777777-7777-4777-8777-777777777777"
}
```

## Interactive Match Script

The same commands can be run without WebSockets in the local interactive
scoring script:

```powershell
python -B tests/interactive_match.py
```

## Tests

```powershell
python -B manage.py test tests -v 2
python -B manage.py check
```

## Demo Security

REST and WebSocket authentication are currently disabled. Anyone who can reach
these endpoints can read match data, create courts and matches, score points,
request or clear an umpire, and perform overrides. Use this configuration only
for local testing. Firebase Admin credentials are still required for Django to
access Firestore.
