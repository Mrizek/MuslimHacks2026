import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { courtActionService, courtActionUnavailable, missingCourtHandlers, umpireRequestStatus } = await server.ssrLoadModule('/src/courtActionService.ts')
test.after(async () => { await server.close() })

const root = process.cwd()
const courtActionSource = readFileSync(join(root, 'src', 'courtActionService.ts'), 'utf8')
const matchServiceSource = readFileSync(join(root, 'src', 'matchService.ts'), 'utf8')
const configSource = readFileSync(join(root, 'src', 'config.ts'), 'utf8')

test('frontend uses the backend WebSocket contracts', () => {
  assert.match(courtActionSource, /wsBaseUrl/)
  assert.match(courtActionSource, /\/matches\/\$\{matchId\}\//)
  assert.match(courtActionSource, /score_point/)
  assert.match(courtActionSource, /request_umpire/)
  assert.match(courtActionSource, /clear_umpire_request/)
  assert.match(courtActionSource, /override/)
})

test('frontend uses the backend REST contracts', () => {
  assert.match(matchServiceSource, /\/courts\//)
  assert.match(matchServiceSource, /\/matches\//)
  assert.match(matchServiceSource, /court_id/)
  assert.match(matchServiceSource, /match_type/)
})

test('frontend keeps API and WebSocket base URLs centralized in Vite env config', () => {
  assert.match(configSource, /VITE_COURTSIDE_API_BASE_URL/)
  assert.match(configSource, /VITE_COURTSIDE_WS_BASE_URL/)
})

const snapshot = { match: { status: 'Live', settings: { expressMode: false, serveClockEnabled: true } }, revision: '1', canUndo: true, umpirePending: false }
const capableService = { ...courtActionService, capabilities: { start: true, correction: true, override: true, changeover: true, umpire: true, clear_umpire: true, clockStart: true, clockPause: true, clockReset: true, clockEnable: true } }

test('backend adapter advertises only commands it can actually send', async () => {
  assert.equal(courtActionService.capabilities.score_team_0, true)
  assert.equal(courtActionService.capabilities.score_team_1, true)
  assert.equal(courtActionService.capabilities.correction, true)
  assert.equal(courtActionService.capabilities.override, true)
  assert.equal(courtActionService.capabilities.umpire, true)
  assert.equal(courtActionService.capabilities.clear_umpire, true)
  assert.equal(courtActionService.capabilities.changeover, undefined)
  assert.equal(courtActionService.unavailableReasons?.changeover, missingCourtHandlers.changeover)
})

test('action guards depend on engine state and advertised capabilities', () => {
  assert.equal(courtActionUnavailable('correction', snapshot, capableService), '')
  assert.equal(courtActionUnavailable('correction', { ...snapshot, canUndo: false }, capableService), 'Nothing to undo')
  assert.equal(courtActionUnavailable('changeover', snapshot, courtActionService), missingCourtHandlers.changeover)
  assert.equal(courtActionUnavailable('changeover', { ...snapshot, revision: '' }, capableService), 'Waiting for match engine state')
  assert.equal(courtActionUnavailable('changeover', { ...snapshot, timer: { phase: 'changeover' } }, capableService), 'Changeover already in progress')
  assert.equal(courtActionUnavailable('changeover', { ...snapshot, match: { ...snapshot.match, settings: { expressMode: true, serveClockEnabled: true } } }, capableService), 'Express mode skips changeovers')
})

test('scheduled matches require engine start, without blocking umpire delivery by match status', () => {
  const scheduled = { ...snapshot, match: { ...snapshot.match, status: 'Scheduled' } }
  for (const action of ['override', 'changeover']) assert.equal(courtActionUnavailable(action, scheduled, capableService), 'Start match first')
  assert.equal(courtActionUnavailable('correction', scheduled, capableService), '')
  assert.equal(courtActionUnavailable('start', scheduled, courtActionService), 'Not available in demo')
  assert.equal(courtActionUnavailable('start', scheduled, capableService), '')
  assert.equal(courtActionUnavailable('start', snapshot, capableService), 'Match already started')
  assert.equal(courtActionUnavailable('umpire', scheduled, capableService), '')
})

test('queued umpire requests never claim delivery', () => {
  for (const [umpireDelivery, expected] of [['queued', 'Pending delivery'], ['delivered', 'Umpire requested'], [undefined, 'Umpire requested']]) {
    const pending = { ...snapshot, umpirePending: true, umpireDelivery }
    assert.equal(umpireRequestStatus(pending), expected)
    assert.equal(courtActionUnavailable('umpire', pending, capableService), expected)
  }
})
