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

Copy the returned `id`, then create a singles match:

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
  "config": {}
}
```

Copy the returned `match_id`. You can retrieve it with:

```http
GET http://127.0.0.1:8000/api/matches/PASTE_MATCH_ID_HERE/
```

## Open a Match WebSocket

Open the browser developer console and run this after replacing the match ID:

```javascript
const socket = new WebSocket(
  "ws://127.0.0.1:8000/ws/matches/PASTE_MATCH_ID_HERE/"
);

socket.onmessage = (event) => console.log(JSON.parse(event.data));

socket.onopen = () => {
  socket.send(JSON.stringify({
    type: "score_point",
    action_id: crypto.randomUUID(),
    payload: { winner_team: 0 }
  }));
};
```

The connection immediately receives `match_snapshot`. A successful point sends
`action_ack`, followed by `match_updated` to every client watching that match.

Other match commands:

```json
{"type":"request_umpire","action_id":"VALID_UUID","payload":{}}
{"type":"clear_umpire_request","action_id":"VALID_UUID","payload":{}}
{"type":"override","action_id":"VALID_UUID","payload":{"changes":{"games":[4,3]}}}
{"type":"get_state","action_id":"VALID_UUID"}
```

Dashboard clients connect to `ws://127.0.0.1:8000/ws/dashboard/` and may send
`get_state` with an `action_id`.

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
