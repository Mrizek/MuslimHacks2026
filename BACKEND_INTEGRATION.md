# Frontend/backend integration

## Implemented

- Vite proxies /api and /ws to 127.0.0.1:8000 and binds its own dev server to
  127.0.0.1. Restart Vite after this configuration change. Production hosting
  would require its own same-origin proxy; vite preview does not supply this one.
- The Backend matches view reads GET /api/courts/ and /api/matches/.
  The /ws/dashboard/ subscription replaces the full feed on match_snapshot and
  updates a match on match_updated. Periodic get_state reads detect deletions
  because current REST create/delete handlers do not broadcast them.
- Each tablet uses /ws/matches/<backend-match-id>/. The real backend ID is retained;
  backendCourtId retains the opaque court ID while a separate display number is
  used by the existing numeric UI components. Team names, player names, server,
  display_score point labels (including AD/tiebreak values), sets, games and
  completed sets are mapped. Complete matches remain Complete.
- No-Ad and the backend's games_per_set, tiebreak_at, tiebreak_points and
  sets_to_win are displayed. Unsupported local timers/deciding-match-tiebreak
  settings are not sent or applied to remote matches.
- Correction sends undo. A small additive change in MatchService.snapshot exposes
  can_undo from persisted history; restart Daphne to use it. Older running servers
  leave Correction disabled with a restart explanation. Undo includes prior umpire
  and override events, as defined by the existing engine, not only scored points.
- Call umpire sends request_umpire. The shared backend saves the flag and
  broadcasts to dashboard/tablet; the dashboard shows Umpire requested. This does
  not claim a human has acknowledged it. No offline queue exists.
- Commands use UUID action_id, wait for the matching action_ack, and issue a
  correlated get_state read before reporting acceptance. Backend errors remain
  visible. A disconnect/timeout reports an unconfirmed outcome. Commands are
  never automatically retried, since the backend has no durable deduplication.
- Local demo is the default. Both modes share the existing CourtSide AI header,
  Courts/Matches/Rules/Sponsors navigation, and a compact source selector.
  Local state remains mounted across source switches; only the backend feed
  mounts/unmounts. Saved Rules/Sponsors remain available and are labelled local
  while backend mode is selected. Backend loading, failure and empty results
  render explicit messages, with a deadline for the initial WebSocket snapshot.

## Dashboard layout regression fixed

The integration put `tabs app-shell` on the mode selector. The existing
`.app-shell { min-height:100vh }` made that selector occupy a full screen; flex
stretching centered the button labels vertically and pushed either dashboard
below the viewport. The entry point and mode callbacks were present. Backend
mode also omitted the tournament navigation. There is now one shared app-shell;
the selector uses dashboard-mode and has no viewport-height or overlay rule.
The SSR regression test renders both modes and saved local matches with a
backend-failure fetch stub, verifies the single-shell structure and unchanged
storage, and requires no backend request. No connected browser was available
for console, computed-layout or physical click verification.
- Socket subscriptions reconnect; connection badges turn connected only after
  receiving data. Disconnected dashboard data is explicitly marked potentially
  stale. Django DEBUG HTML is never inserted into the UI or exposed as an error.
- Local demo data remains under its original localStorage keys, in a separate
  Local demo view. Backend feed state is never written to those keys. No saved
  matches, settings, sponsors or pending rule-change records are migrated/reset.

## Still unsupported

Override stays disabled: although backend score validation exists, REST and WS
entry points bypass organizer authorization and no override reason audit is saved.
Force changeover and serve timers have no engine support. There is no scheduled
start endpoint; POST /api/matches/ creates an already-in-progress match. Backend
match creation/scoring commands can still be used through its existing API/tools;
this integration does not create a new backend match from local demo records.

The UI's revision token is an observation of state, not a server revision. It can
reject a locally observed stale click but cannot prevent concurrent remote edits.
Server-side expected-revision checks, durable command deduplication, authenticated
organizer resolution and offline persistence remain team backend work. Backend
undo does not work offline; only the Python service owns its persisted history.

## Local setup and verification

Keep Daphne bound to localhost while demo authentication is disabled. From the
repository root, in a terminal with the real Firebase project and application
credentials configured:

```powershell
.\.venv-backend\Scripts\python.exe -B -m daphne -b 127.0.0.1 -p 8000 courtside_backend.asgi:application
```

In another terminal:

```powershell
npm.cmd run dev
```

Use the URL Vite prints. Open Backend matches, then Court display on an existing
match. Reconnecting subscriptions load saved backend state; no fake fixture is
used as application fallback.

Backend settings automatically load the root .env. No root .env or Firebase
environment variables were visible in the agent's environment on 2026-09-06.
A read-only Firestore query failed with DefaultCredentialsError. No secret values
were printed. A separately running terminal could have its own environment.

Required real Firestore setup from the team:

- FIREBASE_PROJECT_ID: the actual Firebase project with Firestore enabled.
- GOOGLE_APPLICATION_CREDENTIALS: absolute path to the team's Firebase service
  account JSON, stored outside this repository. Existing Application Default
  Credentials are also accepted by matches/firebase.py. Never put Admin
  credentials in frontend VITE variables.
- DJANGO_SECRET_KEY: a local secret; DJANGO_DEBUG=true and
  DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1 for this localhost demo.
- Alternative: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 plus a matching project ID,
  if the team intentionally runs the Firestore emulator. Setting the variable
  alone does not start an emulator or verify cloud access.

Read-only checks after starting Daphne and Vite:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health/
Invoke-RestMethod http://127.0.0.1:8000/api/matches/
# Replace 5173 if Vite selected another port.
Invoke-RestMethod http://127.0.0.1:5173/api/matches/
```

Health does not access Firestore. An empty matches array means the read succeeded
but there is no backend match to display; use existing team data or the backend's
/api/docs/ court/match creation flow. Do not reuse local numeric court IDs as
Firestore IDs.

## Test evidence / limitations

Frontend build and 13 Node regression tests passed, including backend schema
mapping, real command envelopes, ack/read correlation, disconnect handling and
legacy can_undo behavior. These use explicit test fixtures, not a running server.
Backend Python 3.12.10 runs outside the agent sandbox. The initial backend suite
reported seven existing WebSocket teardown CancelledError errors; REST/service
tests passed. A targeted rerun passed all 8 serialization/REST/service tests,
including the new persisted can_undo regression. Live localhost health/match/court requests were refused even outside
the sandbox. Therefore a real Firebase match read through the frontend is still
blocked, not verified. No browser was available for visual verification.
