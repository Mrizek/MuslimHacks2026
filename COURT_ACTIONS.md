# Court action integration status

No tablet action is connected to a match engine in this repository. All four
capabilities are disabled in `src/courtActionService.ts`. The changeover preview
works locally; it is explicitly a preview, not an accepted changeover request.

Existing shared handlers are `MatchService.createScheduledMatch` and
`ChangeRequestService.createChangeRequest` in `src/matchService.ts`. Neither
handles scoring or umpire requests. Persistence in `App.tsx` uses localStorage;
there is no match synchronization transport, scoring history, or authenticated
organizer session. The Python file only performs speech recognition.

## Missing implementations

The concrete missing adapter is `CourtActionService.execute(command)` plus
`CourtActionService.subscribe(courtId, matchId, receive)`. Its typed commands
already carry court ID, match ID, expected revision and idempotency request ID.
Do not enable capabilities until the corresponding operations are implemented:

| Action | Required engine/service operation |
| --- | --- |
| Correction | Undo the latest scoring event atomically, restoring complete engine state (score, server, history and timers). Publish a full snapshot with `canUndo` and a description of what changed. |
| Override | Authenticate/authorize the organizer, validate proposed `Match.scores` and `Match.server` against scoring rules, check the expected revision, and persist the required reason in an audit record with the accepted change. |
| Force changeover | Validate changeover eligibility, deduplicate requests, persist the engine transition and publish its authoritative `MatchTimerState`. |
| Call umpire | Persist a court/match-scoped request, deduplicate active requests, publish pending state to tablet and organizer, and provide authorized acknowledge/resolve operations with persisted lifecycle and dashboard subscriptions. No umpire lifecycle service or dashboard handlers currently exist. |

The adapter must publish accepted updates to the organizer as well as tablets.
Replacing only the tablet's snapshot does not persist or synchronize a match.
Do not substitute scheduled-match creation, rule-change requests or browser
storage writes for engine acceptance. Other courts must retain their state.

## UI behavior prepared for the adapter

- Unavailable buttons identify the missing dependency and cannot submit.
- Correction is also disabled when a connected snapshot reports `canUndo: false`.
- Override edits a separate draft with current/proposed scores and server plus a
  required reason. Cancel discards the draft without calling the service. Client
  completeness checks do not substitute for scoring-engine validation.
- Override and changeover require confirmation; revision changes block a stale
  confirmation. The in-flight lock prevents repeated submissions.
- Errors remain visible; success is shown only for accepted, matching snapshots.
  Brief confirmations clear after six seconds; pending umpire status persists.
- Existing countdown, sponsor playback and Time warning are retained. A connected
  changeover uses the snapshot timer; the local preview is separate.

Build: `npm run build` from `frontend` (use `npm.cmd` in restricted PowerShell).
Fallback checks: `node --test tests/courtActionService.test.mjs` from `frontend`.
