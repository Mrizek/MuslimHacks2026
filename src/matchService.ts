import type { Match, MatchFormat, MatchSettings, PendingChangeRequest } from './types'

export type CreateMatchInput = { courtId: number; format: MatchFormat; teams: [string[], string[]]; server: string; settings: MatchSettings }
export interface MatchService { createScheduledMatch(input: CreateMatchInput): Promise<Match> }
export interface ChangeRequestService { createChangeRequest(matchIds: string[], requestedSettings: MatchSettings): Promise<PendingChangeRequest> }
export const localMatchService: MatchService = { createScheduledMatch: async (input) => ({ id: `match-${crypto.randomUUID()}`, ...input, status: 'Scheduled', scores: [{ sets: '-', games: '-', points: '-' }, { sets: '-', games: '-', points: '-' }] }) }
export const localChangeRequestService: ChangeRequestService = { createChangeRequest: async (matchIds, requestedSettings) => ({ id: `request-${Date.now()}`, matchIds, requestedSettings, status: 'Pending court confirmation', createdAt: new Date().toISOString() }) }