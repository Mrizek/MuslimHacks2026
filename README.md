# CourtSide AI

CourtSide AI is a local tennis tournament app with a Vite React frontend and a Django Channels backend. The frontend uses Django REST endpoints for courts and matches, then uses WebSockets for live scoring and dashboard updates.

## What Is In This Repo

- Frontend: Vite + React + TypeScript in `src/`, started with `npm run dev`.
- Backend: Django + Channels in `courtside_backend/` and `matches/`, started with Daphne.
- Scoring engine: pure Python in `scoring_engine/`. The frontend does not calculate tennis scores.
- Persistence: Firestore through Firebase Admin on the backend only.
- WebSockets: single-process `InMemoryChannelLayer`, so run one Daphne process for local development.

## Prerequisites

Install these first:

- Python 3.11 or newer
- Node.js 22 or newer
- npm
- A Firebase service-account JSON file for the Firestore project

Keep the Firebase service-account JSON outside this repository. Do not put Firebase Admin credentials in the frontend env file.

## Install Dependencies

Open Windows PowerShell in the repo root:

```powershell
cd "C:\Users\rayan\OneDrive\Bureau\muslimhacks\MuslimHacks2026"
```

Install Python dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Install frontend dependencies:

```powershell
npm install
```

## Environment Files

Create the backend env file at the repo root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Example `.env`:

```dotenv
DJANGO_SECRET_KEY=local-demo-only-change-me
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=C:\absolute\path\outside\this\repo\firebase-service-account.json
```

Create the frontend env file at the repo root:

```powershell
Copy-Item .env.local.example .env.local
notepad .env.local
```

Example `.env.local`:

```dotenv
VITE_COURTSIDE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_COURTSIDE_WS_BASE_URL=ws://127.0.0.1:8000/ws
```

Vite only exposes variables that start with `VITE_`. Do not add Firebase Admin credentials to `.env.local`.

## Start The App

Use two separate PowerShell terminals.

Terminal 1, backend:

```powershell
cd "C:\Users\rayan\OneDrive\Bureau\muslimhacks\MuslimHacks2026"
.\.venv\Scripts\Activate.ps1
python -B -m daphne -b 127.0.0.1 -p 8000 courtside_backend.asgi:application
```

Terminal 2, frontend:

```powershell
cd "C:\Users\rayan\OneDrive\Bureau\muslimhacks\MuslimHacks2026"
npm run dev -- --host=127.0.0.1
```

Open the React frontend:

```text
http://127.0.0.1:5173/
```

Backend health check:

```text
http://127.0.0.1:8000/api/health/
```

Backend API docs:

```text
http://127.0.0.1:8000/api/docs/
```

There is one browser frontend in this repo: the Vite React app at `http://127.0.0.1:5173/`.

## Same Wi-Fi Device Access

Find the backend computer's LAN IP:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*"} | Select-Object IPAddress,InterfaceAlias
```

Suppose the LAN IP is `192.168.1.25`.

Update `.env`:

```dotenv
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.25
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.25:5173
```

Update `.env.local`:

```dotenv
VITE_COURTSIDE_API_BASE_URL=http://192.168.1.25:8000/api
VITE_COURTSIDE_WS_BASE_URL=ws://192.168.1.25:8000/ws
```

Start the backend and frontend on all interfaces:

```powershell
python -B -m daphne -b 0.0.0.0 -p 8000 courtside_backend.asgi:application
```

```powershell
npm run dev -- --host=0.0.0.0
```

On another phone, tablet, emulator, or computer on the same Wi-Fi, open:

```text
http://192.168.1.25:5173/
```

If Windows Firewall asks, allow Python and Node.js on private networks.

## Walkthrough

1. Open `http://127.0.0.1:5173/`.
2. The Courts tab uses two backend court slots: `Court 1` and `Court 2`. If fewer than two court documents exist, the app creates the missing court records when Firestore is reachable.
3. Click `Start new match` on an available court.
4. Enter player names, choose singles or doubles, choose the initial server, and start the match.
5. Click `Court display`.
6. Wait for `Connected`. The display is restored from `/ws/matches/{match_id}/`.
7. Use `Point Team 1` or `Point Team 2`. The command goes through the match WebSocket and Django's Python scoring engine returns the new score.
8. Return to the dashboard. The court card updates through `/ws/dashboard/`.
9. When the backend marks a match complete, that court becomes available again and the old completed match remains in Firestore and in the Matches tab history.
10. Refresh the page or close and reopen the court display. The UI restores from the backend snapshot instead of local mock data.

## Backend Contracts Used By The Frontend

REST:

- `GET /api/courts/`
- `POST /api/courts/`
- `GET /api/matches/`
- `POST /api/matches/`

Match WebSocket:

- URL: `/ws/matches/{match_id}/`
- Receives: `match_snapshot`, `match_updated`, `action_ack`, `error`
- Sends scoring command:

```json
{"type":"score_point","action_id":"UUID-HERE","payload":{"winner_team":0}}
```

- Sends umpire commands:

```json
{"type":"request_umpire","action_id":"UUID-HERE","payload":{}}
{"type":"clear_umpire_request","action_id":"UUID-HERE","payload":{}}
{"type":"undo","action_id":"UUID-HERE","payload":{}}
```

Dashboard WebSocket:

- URL: `/ws/dashboard/`
- Receives dashboard snapshots and match updates across courts.
- The frontend does not send scoring commands through this socket.

## Troubleshooting

If the frontend says it cannot load backend data:

- Make sure Daphne is running on port `8000`.
- Open `http://127.0.0.1:8000/api/health/`.
- Check `.env.local` points to the same backend host and port.

If WebSocket scoring stays disconnected:

- Check `VITE_COURTSIDE_WS_BASE_URL`.
- Use `ws://...` for local HTTP development, not `wss://...`.
- Restart `npm run dev` after editing `.env.local`.

If the browser reports CORS errors:

- Add the exact frontend origin to `DJANGO_CORS_ALLOWED_ORIGINS`.
- For localhost, include `http://localhost:5173` and `http://127.0.0.1:5173`.
- For another device, include `http://YOUR-LAN-IP:5173`.
- Restart Daphne after editing `.env`.

If Django reports `DisallowedHost`:

- Add the backend hostname or LAN IP to `DJANGO_ALLOWED_HOSTS`.
- Restart Daphne.

If Firestore writes fail:

- Confirm `GOOGLE_APPLICATION_CREDENTIALS` is an absolute path to a real service-account JSON file.
- Confirm `FIREBASE_PROJECT_ID` matches that service account's project.
- Confirm the computer has internet access to Google Firestore.
- Keep the credential path in backend `.env` only.

If URLs are wrong from a phone or emulator:

- Do not use `127.0.0.1` on the phone unless the backend is running inside that same device/emulator.
- Use the backend computer's LAN IP in `.env.local`.
- Restart the Vite server after changing `.env.local`.

## Verification Run

Automated checks run in this workspace:

```powershell
npm run build
npm run lint
node --test tests\courtActionService.test.mjs
python manage.py test tests.test_backend tests.test_scoring_engine
```

Results:

- Frontend TypeScript production build passed.
- Frontend lint passed.
- Frontend REST/WebSocket contract test passed.
- Django backend and scoring tests passed: 25 tests.

Live Daphne smoke:

- `GET /api/health/` returned `200`.
- Creating a temporary court through Firestore could not complete in this environment because the sandbox could not connect to Google Firestore. The backend tests verify the REST and WebSocket contracts with the in-memory repository.
# Tennis Voice Recognition

A focused Deepgram microphone stream for recognizing tennis score calls.

## Run

From this folder:

```powershell
python server.py
```

Set `DEEPGRAM_API_KEY`, then run:

```powershell
python speechRecognition.py
```

Speak score calls such as `40-30`, `Fault`, or `Correction`. Microphone frames are cleaned before transcription: DC offset is removed, quiet/noise-only frames are suppressed, and speech is given bounded automatic gain. Every recognized call is held for verification: say `yes`, `confirm`, `correct`, or `right` to send it to the backend callback, or say `no`, `cancel`, `wrong`, or `repeat` to discard it. Nothing reaches the backend before verification. Silent/low-energy microphone frames are filtered locally, and only exact score-shaped calls are accepted, which helps reject speech from adjacent courts. Common variants such as `fourty` are corrected before parsing, while unrelated phrases are printed as `IGNORED`.

Connect backend score/state updates in `on_verified_call(call)` inside `speechRecognition.py`. It receives normalized values such as `30-40` only after confirmation.

A single microphone cannot reliably spatially separate two courts. For strong adjacent-court interference, use a directional microphone close to the umpire or one microphone per court. Press `Ctrl+C` to stop.
