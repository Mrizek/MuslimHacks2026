import type { Match } from './types'

export type CourtAction = 'correction' | 'override' | 'changeover' | 'umpire'
export type MatchTimerState = { phase: 'serve' | 'changeover'; endsAt: number | null; remainingSeconds: number }
export type CourtSnapshot = { match: Match; revision: string; timer?: MatchTimerState; umpirePending: boolean; canUndo: boolean }
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
  correction: 'Unavailable — scoring undo/history not connected',
  override: 'Unavailable — scoring validation and organizer authorization not connected',
  changeover: 'Unavailable — match engine changeover not connected',
  umpire: 'Unavailable — umpire request service not connected',
}

// No scoring or synchronization backend is connected in the local demo.
export const courtActionService: CourtActionService = {
  capabilities: {},
  unavailableReasons: missingCourtHandlers,
  subscribe: () => () => {},
  execute: async ({ action }) => ({ accepted: false, reason: missingCourtHandlers[action] }),
}
