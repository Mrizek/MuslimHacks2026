import type { Match } from './types'

export type CourtAction = 'start' | 'correction' | 'override' | 'changeover' | 'umpire' | 'umpireResolve' | 'clockStart' | 'clockPause' | 'clockReset' | 'clockEnable' | 'changeoverWarning'
export type MatchTimerState = { phase: 'serve' | 'changeover'; endsAt: number | null; remainingSeconds: number; warningIssued?: boolean; started?: boolean }
export type CourtSnapshot = { match: Match; revision: string; connectionError?: string; timer?: MatchTimerState; serveClock?: MatchTimerState; umpirePending: boolean; umpireDelivery?: 'local' | 'queued' | 'delivered'; canUndo: boolean }
export type OverrideProposal = Pick<Match, 'scores' | 'server'>
type CommandContext = { courtId: number; matchId: string; expectedRevision: string; requestId: string }
export type CourtCommand = CommandContext & (
  | { action: 'override'; proposed: OverrideProposal; reason: string }
  | { action: Exclude<CourtAction, 'override'> }
)
export type CourtActionResult = { accepted: true; snapshot: CourtSnapshot; description: string } | { accepted: false; reason: string }

/** Adapter for the authoritative match engine. Authorization, undo history,
 * revision checks and request deduplication must be enforced by the service.
 * Subscribe must immediately emit the current snapshot and subsequent updates.
 * Correction must restore the complete previous engine state (including server,
 * timers and history), and return a human-readable before/after description.
 * Override must authorize the organizer, validate the entire proposal using the
 * scoring rules, and atomically persist the reason and resulting engine state.
 * Changeover must validate the rules and return the authoritative timer.
 * Umpire requests must persist court/match identity and remain pending until
 * resolved by the organizer. Retries with one requestId must be idempotent.
 * Accepted snapshots must already be persisted and published to all subscribers,
 * including the organizer dashboard; UI state alone is not acceptance.
 */
export interface CourtActionService {
  capabilities: Partial<Record<CourtAction, boolean>>
  unavailableReasons?: Partial<Record<CourtAction, string>>
  subscribe(courtId: number, matchId: string, receive: (snapshot: CourtSnapshot) => void): () => void
  execute(command: CourtCommand): Promise<CourtActionResult>
}

export const missingCourtHandlers: Record<CourtAction, string> = {
  start: 'Not available in demo',
  correction: 'Not available in demo',
  override: 'Not available in demo',
  changeover: 'Not available in demo',
  umpire: 'Not available in demo',
  umpireResolve: 'Not available in demo',
  clockStart: 'Not available in demo',
  clockPause: 'Not available in demo',
  clockReset: 'Not available in demo',
  clockEnable: 'Not available in demo',
  changeoverWarning: 'Not available in demo',
}

export function umpireRequestStatus(snapshot: CourtSnapshot): string {
  if (!snapshot.umpirePending) return ''
  return snapshot.umpireDelivery === 'queued' ? 'Pending delivery' : snapshot.umpireDelivery === 'delivered' || snapshot.umpireDelivery === 'local' ? 'Umpire requested' : 'Delivery unconfirmed'
}

/** Connection is informational. Each adapter must enforce state, persistence,
 * authorization and delivery requirements before accepting a command, including
 * offline commands. A queued umpire request must explicitly report queued delivery.
 * Start must initialize scores, serving order and timers through the engine.
 */
export function courtActionUnavailable(action: CourtAction, snapshot: CourtSnapshot, service: CourtActionService): string {
  if (!service.capabilities[action]) return service.unavailableReasons?.[action] ?? missingCourtHandlers[action]
  if (action === 'umpire' && snapshot.umpirePending) return umpireRequestStatus(snapshot)
  if (action === 'umpireResolve') return snapshot.umpirePending ? '' : 'No pending request'
  if (action === 'correction') return snapshot.canUndo ? '' : 'Nothing to undo'
  if (snapshot.match.status === 'Complete') return 'Match complete'
  if (action === 'start' && snapshot.match.status !== 'Scheduled') return 'Match already started'
  if (action !== 'start' && action !== 'umpire' && snapshot.match.status !== 'Live') return 'Start match first'
  if (snapshot.connectionError) return snapshot.connectionError
  if (!snapshot.revision) return 'Waiting for match engine state'
  if (action === 'changeover' && snapshot.match.settings.expressMode) return 'Express mode skips changeovers'
  if (action === 'changeover' && snapshot.timer?.phase === 'changeover') return 'Changeover already in progress'
  if (action.startsWith('clock') && snapshot.timer?.phase === 'changeover') return 'Changeover in progress'
  if (action.startsWith('clock') && action !== 'clockEnable' && !snapshot.match.settings.serveClockEnabled) return 'Enable serve clock first'
  return ''
}

// No scoring or synchronization backend is connected in the local demo.
export const courtActionService: CourtActionService = {
  capabilities: {},
  unavailableReasons: missingCourtHandlers,
  subscribe: () => () => {},
  execute: async ({ action }) => ({ accepted: false, reason: missingCourtHandlers[action] }),
}
