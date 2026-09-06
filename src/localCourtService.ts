import type { Match } from './types'
import { courtActionUnavailable, type CourtAction, type CourtActionService, type CourtCommand, type CourtActionResult, type CourtSnapshot, type MatchTimerState, type OverrideProposal } from './courtActionService.ts'

type SavedState = { match: Match; serveClock: MatchTimerState; changeover?: MatchTimerState; umpirePending: boolean }
type LocalState = { revision: number; history: SavedState[]; serveClock: MatchTimerState; changeover?: MatchTimerState; umpirePending: boolean; requestIds: string[] }
type RecordMatch = Match & { localState?: LocalState }
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const secondsLeft = (timer: MatchTimerState, now = Date.now()) => Math.max(0, timer.endsAt === null ? timer.remainingSeconds : Math.ceil((timer.endsAt - now) / 1000))
const duration = (seconds: number, fallback: number) => Number.isInteger(seconds) && seconds > 0 ? seconds : fallback
const freshClock = (match: Match): MatchTimerState => ({ phase: 'serve', endsAt: null, remainingSeconds: duration(match.settings.serveClockSeconds, 25), started: false })
function metadata(match: RecordMatch): LocalState {
  return match.localState ?? { revision: 0, history: [], serveClock: freshClock(match), umpirePending: false, requestIds: [] }
}
function saveState(record: RecordMatch): SavedState {
  const { localState: _local, ...match } = record
  const state = metadata(record)
  return clone({ match, serveClock: state.serveClock, changeover: state.changeover, umpirePending: state.umpirePending })
}

/** Validate an editable current game. Finished games/sets must be reflected in
 * games/sets, rather than left in the point counters. Existing saved records are
 * never revalidated or rewritten on load. */
export function validateOverride(match: Match, proposed: OverrideProposal): string {
  if (!proposed.server || !match.teams.flat().includes(proposed.server)) return 'Choose a current player as server.'
  if (!Array.isArray(proposed.scores) || proposed.scores.length !== 2) return 'Enter both team scores.'
  const scores = proposed.scores
  if (scores.some(s => !/^(0|[1-9]\d*)$/.test(s.sets) || !/^(0|[1-9]\d*)$/.test(s.games))) return 'Sets and games must be non-negative whole numbers.'
  const sets = scores.map(s => Number(s.sets)), games = scores.map(s => Number(s.games))
  if (sets.some(n => !Number.isSafeInteger(n)) || games.some(n => !Number.isSafeInteger(n))) return 'Score values are too large.'
  if (games.some(n => n > 6) || (Math.max(...games) >= 6 && Math.abs(games[0] - games[1]) >= 2)) return 'Record a completed set in Sets and reset Games for the next set.'
  const tie = games.every(n => n === 6) || ((match.settings.tiebreakPoints === 10 || match.settings.decidingTiebreak) && sets.every(n => n === 1) && games.every(n => n === 0))
  if (tie) {
    if (scores.some(s => !/^(0|[1-9]\d*)$/.test(s.points) || !Number.isSafeInteger(Number(s.points)))) return 'Tiebreak points must be non-negative whole numbers.'
    const points = scores.map(s => Number(s.points)), target = games.every(n => n === 6) ? 7 : 10
    if (Math.max(...points) >= target && Math.abs(points[0] - points[1]) >= 2) return 'Record the finished tiebreak in Games/Sets and reset Points.'
  } else {
    if (scores.some(s => !['0', '15', '30', '40', 'AD'].includes(s.points))) return 'Points must be 0, 15, 30, 40 or AD (numeric counts only during a tiebreak).'
    if (scores.some(s => s.points === 'AD') && (match.settings.noAd || !scores.some(s => s.points === '40') || scores.every(s => s.points === 'AD'))) return 'Advantage requires standard scoring with the other team at 40.'
  }
  return ''
}

/** One atomic localStorage record contains every match, its history and clocks.
 * Reads always use the latest saved data; subscribers receive only persisted
 * changes. No network, authentication or external delivery is involved. */
export class LocalCourtService implements CourtActionService {
  capabilities = Object.fromEntries(['start', 'correction', 'override', 'changeover', 'umpire', 'umpireResolve', 'clockStart', 'clockPause', 'clockReset', 'clockEnable', 'changeoverWarning'].map(action => [action, true])) as Record<CourtAction, boolean>
  private storage: StoragePort
  private initial: Match[]
  private now: () => number
  private listeners = new Set<() => void>()
  constructor(storage: StoragePort, initial: Match[] = [], now = Date.now) { this.storage = storage; this.initial = initial; this.now = now }
  getMatches(): RecordMatch[] {
    const raw = this.storage.getItem('tennis-matches')
    const matches = raw === null ? clone(this.initial) : JSON.parse(raw)
    if (!Array.isArray(matches)) throw new Error('Saved matches are invalid. No data was changed.')
    return matches
  }
  snapshot(match: RecordMatch): CourtSnapshot {
    const state = metadata(match)
    return { match: clone(match), revision: String(state.revision), serveClock: clone(state.serveClock), timer: clone(state.changeover ?? state.serveClock), canUndo: state.history.length > 0, umpirePending: state.umpirePending, umpireDelivery: 'local' }
  }
  private commit(matches: RecordMatch[]) {
    this.storage.setItem('tennis-matches', JSON.stringify(matches))
    this.notify()
  }
  notify() { for (const listener of this.listeners) listener() }
  subscribeAll(receive: (matches: Match[]) => void) {
    const listener = () => receive(this.getMatches())
    this.listeners.add(listener); listener()
    return () => { this.listeners.delete(listener) }
  }
  subscribe(courtId: number, matchId: string, receive: (snapshot: CourtSnapshot) => void) {
    const listener = () => { const match = this.getMatches().find(m => m.id === matchId && m.courtId === courtId); if (match) receive(this.snapshot(match)) }
    this.listeners.add(listener); listener()
    return () => { this.listeners.delete(listener) }
  }
  addMatch(match: Match) {
    const matches = this.getMatches()
    if (matches.some(m => m.courtId === match.courtId || m.id === match.id)) throw new Error('Court or match is already assigned.')
    this.commit([...matches, match])
  }
  /** Called by the shared UI heartbeat, including immediately after a reload. */
  tick() {
    const matches = this.getMatches()
    let changed = false
    for (const match of matches) {
      const state = match.localState
      if (!state) continue
      let expired = false
      if (state.changeover?.endsAt !== null && state.changeover?.endsAt !== undefined && state.changeover.endsAt <= this.now()) { delete state.changeover; expired = true }
      if (state.serveClock.endsAt !== null && state.serveClock.endsAt <= this.now()) { state.serveClock = { ...state.serveClock, endsAt: null, remainingSeconds: 0 }; expired = true }
      if (expired) { state.revision++; changed = true }
    }
    if (changed) this.commit(matches)
  }
  async execute(command: CourtCommand): Promise<CourtActionResult> {
    try {
      const matches = this.getMatches(), index = matches.findIndex(m => m.id === command.matchId && m.courtId === command.courtId)
      if (index < 0) return { accepted: false, reason: 'Match not found on this court.' }
      let record = matches[index]
      const state = metadata(record), snapshot = this.snapshot(record)
      if (state.requestIds.includes(command.requestId)) return { accepted: false, reason: 'Action already saved.' }
      if (command.expectedRevision !== snapshot.revision) return { accepted: false, reason: 'Match changed. Review the latest state.' }
      const unavailable = courtActionUnavailable(command.action, snapshot, this)
      if (unavailable) return { accepted: false, reason: unavailable }
      const previous = saveState(record)
      let description = ''
      switch (command.action) {
        case 'start':
          if (!record.teams.flat().includes(record.server)) return { accepted: false, reason: 'Select a current player as the initial server.' }
          state.history.push(previous)
          record = { ...record, status: 'Live', scores: [{ sets: '0', games: '0', points: '0' }, { sets: '0', games: '0', points: '0' }], setHistory: [] }
          state.serveClock = freshClock(record); delete state.changeover; description = 'Match started.'; break
        case 'override': {
          const reason = validateOverride(record, command.proposed)
          if (reason) return { accepted: false, reason }
          state.history.push(previous)
          const proposed = command.proposed as Pick<Match, 'scores' | 'server'>
          record = { ...record, scores: clone(proposed.scores), server: proposed.server }; description = 'Scores and server updated locally.'; break
        }
        case 'correction': {
          const restored = state.history.pop()!
          record = { ...restored.match }
          state.serveClock = restored.serveClock; state.changeover = restored.changeover; state.umpirePending = restored.umpirePending
          // Restore running clocks with their captured remaining time, not an
          // obsolete deadline from before the corrected edit.
          for (const timer of [state.serveClock, state.changeover]) if (timer?.endsAt != null) timer.endsAt = this.now() + timer.remainingSeconds * 1000
          description = `Restored ${record.scores.map(s => `${s.sets}/${s.games}/${s.points}`).join(' – ')}; server ${record.server}.`; break
        }
        case 'changeover':
          state.serveClock = { ...state.serveClock, remainingSeconds: secondsLeft(state.serveClock, this.now()), endsAt: null }
          state.changeover = { phase: 'changeover', remainingSeconds: duration(record.settings.changeoverSeconds, 90), endsAt: this.now() + duration(record.settings.changeoverSeconds, 90) * 1000, warningIssued: false }
          description = 'Changeover started.'; break
        case 'changeoverWarning':
          if (!state.changeover || state.changeover.warningIssued || secondsLeft(state.changeover, this.now()) > 10 || secondsLeft(state.changeover, this.now()) === 0) return { accepted: false, reason: 'Warning already issued or not due.' }
          state.changeover.warningIssued = true; description = 'Time'; break
        case 'umpire': state.umpirePending = true; description = 'Official requested (recorded in this browser).'; break
        case 'umpireResolve': state.umpirePending = false; description = 'Official request resolved.'; break
        case 'clockEnable': record = { ...record, settings: { ...record.settings, serveClockEnabled: true } }; state.serveClock = freshClock(record); description = 'Serve clock enabled.'; break
        case 'clockReset': state.serveClock = freshClock(record); description = 'Serve clock reset.'; break
        case 'clockPause': state.serveClock = { ...state.serveClock, remainingSeconds: secondsLeft(state.serveClock, this.now()), endsAt: null }; description = 'Serve clock paused.'; break
        case 'clockStart': {
          const remaining = secondsLeft(state.serveClock, this.now())
          if (!remaining) return { accepted: false, reason: 'Reset the clock first.' }
          if (state.serveClock.endsAt !== null) return { accepted: false, reason: 'Clock already running.' }
          state.serveClock.endsAt = this.now() + remaining * 1000; state.serveClock.remainingSeconds = remaining; state.serveClock.started = true; description = 'Serve clock running.'; break
        }
      }
      // Capture exact remaining time in the undo record at edit time.
      if (['override', 'start'].includes(command.action)) for (const timer of [previous.serveClock, previous.changeover]) if (timer) timer.remainingSeconds = secondsLeft(timer, this.now())
      state.revision++; state.requestIds = [...state.requestIds, command.requestId].slice(-100)
      record.localState = state; matches[index] = record
      this.commit(matches)
      return { accepted: true, snapshot: this.snapshot(record), description }
    } catch { return { accepted: false, reason: 'Could not save the action. Check browser storage; no change was applied.' } }
  }
}
