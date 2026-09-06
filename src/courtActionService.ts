import { courtsideConfig } from './config'
import { matchFromBackend } from './matchService'
import type { BackendMatchSnapshot, BackendMatchState, Match } from './types'

export type CourtAction = 'start' | 'score_team_0' | 'score_team_1' | 'correction' | 'override' | 'changeover' | 'umpire' | 'clear_umpire' | 'umpireResolve' | 'clockStart' | 'clockPause' | 'clockReset' | 'clockEnable' | 'changeoverWarning'
export type MatchTimerState = { phase: 'serve' | 'changeover'; endsAt: number | null; remainingSeconds: number; warningIssued?: boolean; started?: boolean }
export type CourtSnapshot = { match: Match; revision: string; connectionError?: string; timer?: MatchTimerState; serveClock?: MatchTimerState; umpirePending: boolean; umpireDelivery?: 'local' | 'queued' | 'delivered'; canUndo: boolean; connected?: boolean; initialSnapshotReady?: boolean; error?: string }
export type OverrideProposal = Partial<Omit<BackendMatchState, 'last_action'> & Pick<Match, 'scores' | 'server'>>
type CommandContext = { courtId: string | number; matchId: string; expectedRevision: string; requestId: string }
export type CourtCommand = CommandContext & (
  | { action: 'override'; proposed: OverrideProposal; reason: string }
  | { action: Exclude<CourtAction, 'override'> }
)
export type CourtActionResult = { accepted: true; snapshot: CourtSnapshot; description: string } | { accepted: false; reason: string }

export interface CourtActionService {
  capabilities: Partial<Record<CourtAction, boolean>>
  unavailableReasons?: Partial<Record<CourtAction, string>>
  subscribe(courtId: string | number, matchId: string, receive: (snapshot: CourtSnapshot) => void): () => void
  execute(command: CourtCommand): Promise<CourtActionResult>
}

export const missingCourtHandlers: Record<CourtAction, string> = {
  start: 'Not available in demo',
  score_team_0: 'Unavailable - match socket not connected',
  score_team_1: 'Unavailable - match socket not connected',
  correction: 'Unavailable - no saved scoring action to undo',
  override: 'Unavailable - match socket not connected',
  changeover: 'Unavailable - no changeover command exists in the backend contract',
  umpire: 'Unavailable - match socket not connected',
  clear_umpire: 'Unavailable - match socket not connected',
  umpireResolve: 'Not available in demo',
  clockStart: 'Not available in demo',
  clockPause: 'Not available in demo',
  clockReset: 'Not available in demo',
  clockEnable: 'Not available in demo',
  changeoverWarning: 'Not available in demo',
}

export function umpireRequestStatus(snapshot: CourtSnapshot): string {
  if (!snapshot.umpirePending) return ''
  return snapshot.umpireDelivery === 'queued' ? 'Pending delivery' : snapshot.umpireDelivery === 'delivered' || snapshot.umpireDelivery === 'local' || snapshot.umpireDelivery === undefined ? 'Umpire requested' : 'Delivery unconfirmed'
}

export function courtActionUnavailable(action: CourtAction, snapshot: CourtSnapshot, service: CourtActionService): string {
  if (!service.capabilities[action]) return service.unavailableReasons?.[action] ?? missingCourtHandlers[action]
  if (snapshot.match.status === 'Complete') return 'Match complete'
  if (action === 'umpire' && snapshot.umpirePending) return umpireRequestStatus(snapshot)
  if (action === 'clear_umpire' || action === 'umpireResolve') return snapshot.umpirePending ? '' : 'No pending request'
  if (action === 'correction') return snapshot.canUndo ? '' : 'Nothing to undo'
  if (action === 'start') return snapshot.match.status === 'Scheduled' ? '' : 'Match already started'
  if (action !== 'umpire' && snapshot.match.status !== 'Live') return 'Start match first'
  if (snapshot.connectionError) return snapshot.connectionError
  if (!snapshot.revision) return 'Waiting for match engine state'
  if (action === 'changeover' && snapshot.match.settings.expressMode) return 'Express mode skips changeovers'
  if (action === 'changeover' && snapshot.timer?.phase === 'changeover') return 'Changeover already in progress'
  if (action.startsWith('clock') && snapshot.timer?.phase === 'changeover') return 'Changeover in progress'
  if (action.startsWith('clock') && action !== 'clockEnable' && !snapshot.match.settings.serveClockEnabled) return 'Enable serve clock first'
  if (snapshot.connected === false || snapshot.initialSnapshotReady === false) return 'Waiting for backend snapshot'
  return ''
}

type MatchSocketMessage = ({ type: 'match_snapshot' | 'match_updated' } & BackendMatchSnapshot & { action_id?: string }) | { type: 'action_ack'; action_id: string; match_id: string } | { type: 'error'; message?: string; code?: string; action_id?: string }
type Subscriber = (snapshot: CourtSnapshot) => void
type SocketEntry = { socket: WebSocket | null; subscribers: Set<Subscriber>; snapshot: CourtSnapshot | null; reconnectTimer: number | null; closed: boolean; pending: Map<string, (value: CourtActionResult) => void> }

function snapshotFromBackend(message: BackendMatchSnapshot, connected: boolean): CourtSnapshot {
  return {
    match: matchFromBackend(message),
    revision: JSON.stringify([message.state.game_number, message.state.point_number, message.state.points, message.state.games, message.state.sets, message.state.umpire_requested, message.state.status]),
    umpirePending: message.state.umpire_requested,
    umpireDelivery: message.state.umpire_requested ? 'delivered' : undefined,
    canUndo: message.can_undo ?? Boolean(message.state.last_action),
    connected,
    initialSnapshotReady: true,
  }
}

function backendOverridePayload(proposed: OverrideProposal) {
  return 'scores' in proposed ? null : proposed
}

class BackendCourtActionService implements CourtActionService {
  capabilities: Partial<Record<CourtAction, boolean>> = { score_team_0: true, score_team_1: true, correction: true, override: true, umpire: true, clear_umpire: true }
  unavailableReasons: Partial<Record<CourtAction, string>> = { changeover: missingCourtHandlers.changeover }
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
    if (!payload) return { accepted: false, reason: this.unavailableReasons?.[command.action] || missingCourtHandlers[command.action] }
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
    if (command.action === 'override') {
      const changes = backendOverridePayload(command.proposed)
      return changes ? { type: 'override', payload: { changes } } : null
    }
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

export function sendMatchOverride(matchId: string, proposed: Partial<Omit<BackendMatchState, 'last_action'>>): Promise<Match> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${courtsideConfig.wsBaseUrl}/matches/${matchId}/`)
    const actionId = crypto.randomUUID()
    const timeout = window.setTimeout(() => {
      socket.close()
      reject(new Error('No acknowledgement from the backend. Check the WebSocket connection.'))
    }, 8000)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'override', action_id: actionId, payload: { changes: proposed } }))
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as MatchSocketMessage
      if (message.type === 'match_snapshot') return
      if (message.type === 'action_ack' && message.action_id !== actionId) return
      if (message.type === 'match_updated') {
        window.clearTimeout(timeout)
        socket.close()
        resolve(matchFromBackend(message))
      }
      if (message.type === 'error') {
        window.clearTimeout(timeout)
        socket.close()
        reject(new Error(message.message || message.code || 'Backend rejected the command.'))
      }
    }
    socket.onerror = () => {
      window.clearTimeout(timeout)
      socket.close()
      reject(new Error('Match socket is not connected yet.'))
    }
  })
}
