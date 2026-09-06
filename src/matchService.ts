import { courtsideConfig } from './config'
import type { BackendMatchSnapshot, Court, Match, MatchFormat, MatchSettings, PendingChangeRequest } from './types'

export type CreateMatchInput = { courtId: string; format: MatchFormat; teams: [string[], string[]]; server: string; settings: MatchSettings }
export interface MatchService { listCourts(): Promise<Court[]>; createCourt(name: string): Promise<Court>; listMatches(): Promise<Match[]>; createScheduledMatch(input: CreateMatchInput): Promise<Match> }
export interface ChangeRequestService { createChangeRequest(matchIds: string[], requestedSettings: MatchSettings): Promise<PendingChangeRequest> }

type ApiError = { message?: string; code?: string }
const defaultSettings: MatchSettings = { noAd: false, decidingTiebreak: true, expressMode: false, serveClockEnabled: true, serveClockSeconds: 25, changeoverSeconds: 90 }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${courtsideConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    let detail: ApiError = {}
    try { detail = await response.json() as ApiError } catch { /* response was not JSON */ }
    throw new Error(detail.message || `${response.status} ${response.statusText}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function formatFromBackend(value: 'singles' | 'doubles'): MatchFormat {
  return value === 'singles' ? 'Singles' : 'Doubles'
}

export function matchFromBackend(snapshot: BackendMatchSnapshot): Match {
  return {
    id: snapshot.match_id,
    courtId: snapshot.court_id,
    format: formatFromBackend(snapshot.match_type),
    teams: snapshot.teams.map((team) => team.players) as [string[], string[]],
    server: snapshot.display_score.server,
    settings: { ...defaultSettings, noAd: snapshot.config.no_ad, decidingTiebreak: snapshot.config.tiebreak_points === 10 },
    status: snapshot.state.status === 'complete' ? 'Complete' : 'Live',
    scores: [
      { sets: String(snapshot.display_score.sets[0]), games: String(snapshot.display_score.games[0]), points: snapshot.display_score.points[0] },
      { sets: String(snapshot.display_score.sets[1]), games: String(snapshot.display_score.games[1]), points: snapshot.display_score.points[1] },
    ],
    setHistory: snapshot.display_score.completed_sets.map((set) => [String(set[0]), String(set[1])]),
    umpireRequested: snapshot.state.umpire_requested,
    backendState: snapshot.state,
  }
}

function createMatchPayload(input: CreateMatchInput) {
  const isSingles = input.format === 'Singles'
  const teamSize = isSingles ? 1 : 2
  const serverTeam = input.teams[1].includes(input.server) ? 1 : 0
  const serverPlayer = Math.max(0, input.teams[serverTeam].indexOf(input.server))
  const order = Array.from({ length: teamSize }, (_, index) => index)
  return {
    court_id: input.courtId,
    teams: input.teams.map((players, teamIndex) => ({
      name: `Team ${teamIndex + 1}`,
      players: players.slice(0, teamSize),
    })),
    match_type: isSingles ? 'singles' : 'doubles',
    config: {
      no_ad: input.settings.noAd,
      games_per_set: 6,
      tiebreak_at: 6,
      tiebreak_points: input.settings.decidingTiebreak ? 10 : 7,
      sets_to_win: isSingles ? 1 : 2,
      starting_server_team: serverTeam,
      starting_server_player: serverPlayer,
      serving_orders: { team_0: order, team_1: order },
      receiving_orders: { team_0: order, team_1: order },
    },
  }
}

export const backendMatchService: MatchService = {
  listCourts: async () => {
    const data = await request<{ courts: { id: string; name: string }[] }>('/courts/')
    return data.courts.map((court) => ({ ...court, connection: 'Connected' }))
  },
  createCourt: async (name) => {
    const court = await request<{ id: string; name: string }>('/courts/', { method: 'POST', body: JSON.stringify({ name }) })
    return { ...court, connection: 'Connected' }
  },
  listMatches: async () => {
    const data = await request<{ matches: BackendMatchSnapshot[] }>('/matches/')
    return data.matches.map(matchFromBackend)
  },
  createScheduledMatch: async (input) => {
    const snapshot = await request<BackendMatchSnapshot>('/matches/', { method: 'POST', body: JSON.stringify(createMatchPayload(input)) })
    return matchFromBackend(snapshot)
  },
}

export const localChangeRequestService: ChangeRequestService = {
  createChangeRequest: async (matchIds, requestedSettings) => ({ id: `request-${Date.now()}`, matchIds, requestedSettings, status: 'Pending court confirmation', createdAt: new Date().toISOString() }),
}
