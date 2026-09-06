export type MatchFormat = 'Singles' | 'Doubles' | 'Mixed doubles'
export type MatchSettings = { noAd: boolean; tiebreakPoints: 7 | 10; gamesPerSet: number; tiebreakAt: number; setsToWin: number; expressMode: boolean; serveClockEnabled: boolean; serveClockSeconds: number; changeoverSeconds: number; decidingTiebreak?: boolean }
export type MatchScore = { sets: string; games: string; points: string }
export type BackendMatchStatus = 'in_progress' | 'complete'
export type Match = { id: string; courtId: string | number; format: MatchFormat; teams: [string[], string[]]; server: string; settings: MatchSettings; status: 'Live' | 'Scheduled' | 'Complete'; scores: [MatchScore, MatchScore]; setHistory?: string[][]; umpireRequested?: boolean; backendState?: BackendMatchState; localState?: any }
export type Court = { id: string | number; name: string; connection: 'Connected' | 'Offline' | 'Local demo' }
export type PendingChangeRequest = { id: string; matchIds: string[]; requestedSettings: MatchSettings; status: 'Pending court confirmation'; createdAt: string }
export type SponsorMediaType = 'Image' | 'Video' | 'Audio'
export type Sponsor = { id: string; name: string; mediaType: SponsorMediaType; mediaUrl: string; imageDurationSeconds: number; enabled: boolean }
export const tournamentConfig = { name: 'Spring Classic', date: 'Saturday, June 14, 2025' }

export type BackendCourt = { id: string; name: string }
export type BackendTeam = { name: string; players: string[] }
export type BackendMatchConfig = {
  no_ad: boolean
  games_per_set: number
  tiebreak_at: number
  tiebreak_points: 7 | 10
  sets_to_win: number
  starting_server_team: 0 | 1
  starting_server_player: number
  serving_orders: { team_0: number[]; team_1: number[] }
  receiving_orders: { team_0: number[]; team_1: number[] }
}
export type BackendMatchState = {
  points: [number, number]
  games: [number, number]
  sets: [number, number]
  completed_sets: [number, number][]
  server_team: 0 | 1
  server_player: number
  receiver_team: 0 | 1
  receiver_player: number
  game_number: number
  point_number: number
  in_tiebreak: boolean
  tiebreak_initial_server_team: number | null
  tiebreak_initial_server_player: number | null
  umpire_requested: boolean
  status: BackendMatchStatus
  winner_team: number | null
  last_action: string | null
}
export type BackendDisplayScore = {
  points: [string, string]
  games: [number, number]
  sets: [number, number]
  completed_sets: [number, number][]
  server: string
  receiver: string
  in_tiebreak: boolean
  umpire_requested: boolean
  status: BackendMatchStatus
  winner: string | null
}
export type BackendMatchSnapshot = {
  match_id: string
  court_id: string
  teams: [BackendTeam, BackendTeam]
  match_type: 'singles' | 'doubles'
  config: BackendMatchConfig
  state: BackendMatchState
  display_score: BackendDisplayScore
  can_undo?: boolean
}
