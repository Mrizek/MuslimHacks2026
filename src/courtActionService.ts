import { courtsideConfig } from './config'
import { matchFromBackend } from './matchService'
import type { BackendMatchSnapshot, Match } from './types'

export type CourtAction = 'score_team_0' | 'score_team_1' | 'correction' | 'override' | 'changeover' | 'umpire' | 'clear_umpire'
export type MatchTimerState = { phase: 'serve' | 'changeover'; endsAt: number | null; remainingSeconds: number }
export type CourtSnapshot = { match: Match; revision: string; timer?: MatchTimerState; umpirePending: boolean; canUndo: boolean; connected: boolean; initialSnapshotReady: boolean; error?: string }
export type OverrideProposal = Pick<Match, 'scores' | 'server'>
type CommandContext = { courtId: string; matchId: string; expectedRevision: string; requestId: string }
export type CourtCommand = CommandContext & (
  | { action: 'override'; proposed: OverrideProposal; reason: string }
  | { action: Exclude<CourtAction, 'override'> }
)
export type CourtActionResult = { accepted: true; snapshot: CourtSnapshot; description: string } | { accepted: false; reason: string }

export interface CourtActionService {
  capabilities: Partial<Record<CourtAction, boolean>>
  unavailableReasons?: Partial<Record<CourtAction, string>>
  subscribe(courtId: string, matchId: string, receive: (snapshot: CourtSnapshot) => void): () => void
  execute(command: CourtCommand): Promise<CourtActionResult>
}

export const missingCourtHandlers: Record<CourtAction, string> = {
  score_team_0: 'Unavailable - match socket not connected',
  score_team_1: 'Unavailable - match socket not connected',
  correction: 'Unavailable - no saved scoring action to undo',
  override: 'Unavailable - use scoring, undo, or umpire commands from this UI',
  changeover: 'Unavailable - no changeover command exists in the backend contract',
  umpire: 'Unavailable - match socket not connected',
  clear_umpire: 'Unavailable - match socket not connected',
}

type MatchSocketMessage = ({ type: 'match_snapshot' | 'match_updated' } & BackendMatchSnapshot) | { type: 'action_ack'; action_id: string; match_id: string } | { type: 'error'; message?: string; code?: string; action_id?: string }
type Subscriber = (snapshot: CourtSnapshot) => void
type SocketEntry = { socket: WebSocket | null; subscribers: Set<Subscriber>; snapshot: CourtSnapshot | null; reconnectTimer: number | null; closed: boolean; pending: Map<string, (value: CourtActionResult) => void> }

function snapshotFromBackend(message: BackendMatchSnapshot, connected: boolean): CourtSnapshot {
  return {
    match: matchFromBackend(message),
    revision: JSON.stringify([message.state.game_number, message.state.point_number, message.state.points, message.state.games, message.state.sets, message.state.umpire_requested, message.state.status]),
    umpirePending: message.state.umpire_requested,
    canUndo: Boolean(message.state.last_action),
    connected,
    initialSnapshotReady: true,
  }
}

class BackendCourtActionService implements CourtActionService {
  capabilities: Partial<Record<CourtAction, boolean>> = { score_team_0: true, score_team_1: true, correction: true, umpire: true, clear_umpire: true }
  unavailableReasons: Partial<Record<CourtAction, string>> = { override: missingCourtHandlers.override, changeover: missingCourtHandlers.changeover }
  private sockets = new Map<string, SocketEntry>()

  subscribe(_courtId: string, matchId: string, receive: Subscriber): () => void {
    const entry = this.getEntry(matchId)
    entry.subscribers.add(receive)
    if (entry.snapshot) receive(entry.snapshot)
    if (!entry.socket || entry.socket.readyState === WebSocket.CLOSED) this.connect(matchId, entry)
    return () => {
      entry.subscribers.delete(receive)
      if (entry.subscribers.size === 0) this.close(matchId, entry)
    }
  }

  async execute(command: CourtCommand): Promise<CourtActionResult> {
    const entry = this.sockets.get(command.matchId)
    if (!entry?.socket || entry.socket.readyState !== WebSocket.OPEN || !entry.snapshot?.initialSnapshotReady) {
      return { accepted: false, reason: 'Match socket is not connected yet.' }
    }
    const payload = this.payloadFor(command)
    if (!payload) return { accepted: false, reason: this.unavailableReasons[command.action] || missingCourtHandlers[command.action] }
    const actionId = crypto.randomUUID()
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        entry.pending.delete(actionId)
        resolve({ accepted: false, reason: 'No acknowledgement from the backend. Check the WebSocket connection.' })
      }, 8000)
      entry.pending.set(actionId, (result) => {
        window.clearTimeout(timeout)
        resolve(result)
      })
      entry.socket?.send(JSON.stringify({ ...payload, action_id: actionId }))
    })
  }

  private payloadFor(command: CourtCommand): { type: string; payload: Record<string, unknown> } | null {
    if (command.action === 'score_team_0') return { type: 'score_point', payload: { winner_team: 0 } }
    if (command.action === 'score_team_1') return { type: 'score_point', payload: { winner_team: 1 } }
    if (command.action === 'correction') return { type: 'undo', payload: {} }
    if (command.action === 'umpire') return { type: 'request_umpire', payload: {} }
    if (command.action === 'clear_umpire') return { type: 'clear_umpire_request', payload: {} }
    return null
  }

  private getEntry(matchId: string): SocketEntry {
    let entry = this.sockets.get(matchId)
    if (!entry) {
      entry = { socket: null, subscribers: new Set(), snapshot: null, reconnectTimer: null, closed: false, pending: new Map() }
      this.sockets.set(matchId, entry)
    }
    return entry
  }

  private connect(matchId: string, entry: SocketEntry) {
    entry.closed = false
    const socket = new WebSocket(`${courtsideConfig.wsBaseUrl}/matches/${matchId}/`)
    entry.socket = socket
    this.publish(entry, entry.snapshot ? { ...entry.snapshot, connected: false, initialSnapshotReady: false, error: undefined } : null)
    socket.onopen = () => this.publish(entry, entry.snapshot ? { ...entry.snapshot, connected: true, initialSnapshotReady: false, error: undefined } : null)
    socket.onmessage = (event) => this.handleMessage(entry, event.data)
    socket.onerror = () => this.publish(entry, entry.snapshot ? { ...entry.snapshot, connected: false, error: 'WebSocket error. Reconnecting...' } : null)
    socket.onclose = () => {
      for (const resolve of entry.pending.values()) resolve({ accepted: false, reason: 'WebSocket disconnected before the command was accepted.' })
      entry.pending.clear()
      this.publish(entry, entry.snapshot ? { ...entry.snapshot, connected: false, initialSnapshotReady: false, error: 'Disconnected. Reconnecting...' } : null)
      if (!entry.closed && entry.subscribers.size > 0) entry.reconnectTimer = window.setTimeout(() => this.connect(matchId, entry), 1500)
    }
  }

  private handleMessage(entry: SocketEntry, raw: string) {
    const message = JSON.parse(raw) as MatchSocketMessage
    if (message.type === 'match_snapshot' || message.type === 'match_updated') {
      const snapshot = snapshotFromBackend(message, true)
      this.publish(entry, snapshot)
      if (message.type === 'match_updated') {
        for (const resolve of entry.pending.values()) resolve({ accepted: true, snapshot, description: 'Backend accepted the command.' })
        entry.pending.clear()
      }
      return
    }
    if (message.type === 'error' && message.action_id) {
      const resolve = entry.pending.get(message.action_id)
      if (resolve) {
        entry.pending.delete(message.action_id)
        resolve({ accepted: false, reason: message.message || message.code || 'Backend rejected the command.' })
      }
    }
  }

  private publish(entry: SocketEntry, snapshot: CourtSnapshot | null) {
    if (snapshot) entry.snapshot = snapshot
    if (!entry.snapshot) return
    for (const subscriber of entry.subscribers) subscriber(entry.snapshot)
  }

  private close(matchId: string, entry: SocketEntry) {
    entry.closed = true
    if (entry.reconnectTimer) window.clearTimeout(entry.reconnectTimer)
    entry.socket?.close()
    this.sockets.delete(matchId)
  }
}

export const courtActionService: CourtActionService = new BackendCourtActionService()
