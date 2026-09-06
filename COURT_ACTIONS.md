# Current integration update (2026-09-06)

Backend files are now imported and the REST/WebSocket frontend adapter is implemented.
See [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md) for current behavior, startup, configuration, and verification limits.
The following is the historical pre-integration audit; its placeholder descriptions are superseded by that document.

# Court action integration audit

Audited 2026-09-05 after fetching origin. The earlier claim that this entire
repository lacks an engine was too broad: the frontend checkout lacks it, but
real Python implementations exist on remote branches. No checkout or merge was
performed. Existing local changes and saved browser data were preserved.

## Branches and instructions inspected

- Current branch frontend; origin/frontend: 47d4cf2.
- origin/main: bfe2855; origin/feature/scoring-engine: d9f76ef. Their
  scoring_engine/, matches/ and courtside_backend/ code is identical.
- origin/feature/frontend and origin/feature/court-tablet: 4f5dee9, empty trees.
- origin/feature/speech-recognition: 806b526, speech transcription and score
  normalization, not a scoring/delivery adapter.
- Reviewed backend README.md, matches/openapi.py, tests/test_backend.py and the
  frontend CourtActionService contract. No AGENTS.md found in inspected trees.

Backend paths below refer to those fetched branches, not this working tree.
Inspect them without switching: git show origin/feature/scoring-engine:<path>.

## Classification

| Requirement | Status | Evidence / remaining gap |
| --- | --- | --- |
| Tablet adapter | 2. Placeholder | src/courtActionService.ts execute always rejects; subscribe is a no-op; capabilities is empty. |
| Scoring and initial server | 1. Real, not wired | scoring_engine/engine.py ScoringEngine._initial_state, score_point, display_score; matches/services.py MatchService.create_match initializes and persists an in-progress engine match. |
| Scheduled-to-start transition | 3. Absent | Backend MatchStatus has only IN_PROGRESS and COMPLETE. Frontend localMatchService.createScheduledMatch creates placeholders. No start command exists for a saved Scheduled match. |
| Undo | 1. Real, not wired; incomplete adapter contract | ScoringEngine.undo/history_count and MatchService.mutate('undo') exist. Service persists up to 100 previous states, including umpire/override events. Snapshot omits canUndo and revision. No persistent browser engine supports offline undo. |
| Serve/changeover engine | 3. Absent | MatchState/MatchConfig have no timers or changeover commands. App.ChangeoverDisplay is an already wired local countdown preview; CourtDisplay can render a supplied engine timer but receives none. |
| Override validation | 1. Real, not wired | MatchService._apply_override and serialization.validate_state validate full proposed state. Direct ScoringEngine.override is more permissive. Required reason/actor audit persistence is absent. |
| Organizer authorization | 1. Real helpers, bypassed | matches/auth.py authenticate_token, Principal, require_organizer and require_command exist. REST views and MatchConsumer pass None, bypassing checks. README explicitly documents anonymous demo access. Frontend sign-in/token flow is absent. |
| Shared umpire request | 1. Real, not wired; incomplete lifecycle | ScoringEngine.request_umpire/clear_umpire_request, MatchService.mutate, FirestoreMatchRepository.transact_match and MatchConsumer persist/broadcast a boolean. Offline queue, delivery receipt, authorized resolve flow and organizer UI handler are absent. |
| Persistence and transport | 1. Real, not wired | FirestoreMatchRepository, MatchConsumer and DashboardConsumer exist remotely. Frontend uses localStorage and has no REST/WS adapter, URL configuration or Vite proxy. |
| Revision checks and durable deduplication | 3. Absent | Consumer validates/echoes action_id but does not pass it to service persistence. No expected-revision check exists; backend tests explicitly assert no version field. |

## Exact handoffs needed

1. **Runtime/configuration:** team supplies running HTTP/WS base URL and real
   court/match IDs. Routes: /api/courts/, /api/matches/, /api/matches/<id>/,
   /ws/matches/<id>/ and /ws/dashboard/. Backend README launches one process with
   python -B -m daphne -b 127.0.0.1 -p 8000 courtside_backend.asgi:application.
   courtside_backend/settings.py and matches/firebase.py use DJANGO_SECRET_KEY,
   DJANGO_DEBUG, DJANGO_ALLOWED_HOSTS, FIREBASE_PROJECT_ID and
   GOOGLE_APPLICATION_CREDENTIALS, or FIRESTORE_EMULATOR_HOST for an emulator.
   Team must supply actual values. Firebase Admin credentials stay server-side,
   never in frontend VITE variables. Current InMemoryChannelLayer requires one
   ASGI process; multiple workers need shared channel-layer configuration.
   Agree on same-origin proxy or CORS; vite.config.ts has no backend proxy.
2. **Command contract:** extend MatchService.mutate/snapshot in matches/services.py,
   MatchConsumer.receive_json in matches/consumers.py and repository transact_match
   with persisted revision checks, durable action-ID deduplication and canUndo.
   Correlate accepted snapshots with action IDs; current action_ack contains only
   action ID/match ID and updates arrive separately.
3. **Authorization/override:** wire matches/auth.py authenticate_token into REST/WS
   entry points, pass Principal instead of None, and supply browser session/token
   transport and organizer claims. Persist reason and actor with the accepted
   override in MatchService._apply_override/repository. Existing require_command
   requires organizer authorization for undo as well as override/clear-umpire.
4. **Start/rules/identity:** team provides scheduled/start lifecycle or explicit
   mapping from local scheduled records to backend create_match. Preserve local
   records and store backend identity separately: local courts use numeric IDs;
   backend courts/matches use generated string IDs. Define sets_to_win,
   serving/receiving order and mixed-doubles mapping. Extend src/types.ts for
   backend COMPLETE status; it currently has only Live/Scheduled. Never recreate
   a saved Live match to initialize it. Latest MatchConfig/serialization removed
   deciding_tiebreak_points while the UI still saves decidingTiebreak; team must
   restore support or agree on compatibility, rather than silently drop settings.
5. **Timers/changeover:** implement settings/state in scoring_engine/models.py,
   engine transition in scoring_engine/engine.py, serialization in
   matches/serialization.py, and commands in MatchService.mutate/MatchConsumer.
   Include authoritative timers in snapshots and undo history.
6. **Umpire lifecycle:** extend request/clear persistence with durable request
   identity, deduplication and authorized resolution. Wire DashboardConsumer to
   organizer UI. If offline queuing is provided, persist the queue and explicitly
   distinguish queued/delivered; queued UI must say Pending delivery.
7. **Frontend wiring after contracts exist:** implement execute/subscribe in
   src/courtActionService.ts, integrate authoritative match/dashboard feeds into
   App.tsx, and backend creation/read mapping in src/matchService.ts. Currently
   CourtDisplay acceptance updates only its own snapshot; App's matches collection
   must also receive the feed. Keep remote records separate from local demo storage.

## Local behavior and verification

Already implemented and wired: scheduled assignment, local saved matches/default
rules/sponsors/pending rule-change records, scoreboard/fullscreen, changeover
preview, sponsor playback and timer rendering. Rule-change records have no backend
court acceptance. Override draft/completeness checks are not engine authorization.

No new action was enabled: the branch implementations cannot currently satisfy
the existing tablet contract for this saved match. Python cannot be imported into
the React browser app, and no configured running backend or identity mapping is
available. No synchronization or delivery success was fabricated.

No listener was found on documented local port 127.0.0.1:8000. Neither python nor
py is available on PATH. Backend tests were inspected, not run; live scoring,
authorization and delivery remain unverified. Frontend npm.cmd run build passed;
node --test tests/courtActionService.test.mjs passed all 9 tests.

Existing tennis-matches, tennis-default-settings, tennis-pending-requests and
tennis-sponsors storage paths are unchanged. Browser storage was not directly
inspected or altered. Local demo status and specific action reasons remain intact.
