import assert from 'node:assert/strict'
import test from 'node:test'
import { courtActionService, missingCourtHandlers, courtActionUnavailable, umpireRequestStatus } from '../src/courtActionService.ts'

for (const action of ['start', 'correction', 'override', 'changeover', 'umpire']) {
  test(`${action} stays unavailable and cannot report a successful mutation`, async () => {
    const command = {
      action, courtId: 1, matchId: 'match-001', expectedRevision: '1', requestId: action,
      ...(action === 'override' ? { proposed: { scores: [{ sets: '1', games: '3', points: '40' }, { sets: '0', games: '2', points: '30' }], server: 'A. Rivera' }, reason: 'Score entered incorrectly' } : {}),
    }
    const before = structuredClone(command)
    assert.ok(!courtActionService.capabilities[action])
    assert.equal(courtActionService.unavailableReasons[action], missingCourtHandlers[action])
    const results = await Promise.all([courtActionService.execute(command), courtActionService.execute(command)])
    for (const result of results) assert.deepEqual(result, { accepted: false, reason: missingCourtHandlers[action] })
    assert.deepEqual(command, before)
  })
}

test('unconnected subscriptions never fabricate match or timer snapshots', async () => {
  const snapshots = []
  const unsubscribe1 = courtActionService.subscribe(1, 'match-001', (snapshot) => snapshots.push(snapshot))
  const unsubscribe2 = courtActionService.subscribe(2, 'match-002', (snapshot) => snapshots.push(snapshot))
  await courtActionService.execute({ action: 'changeover', courtId: 1, matchId: 'match-001', expectedRevision: '1', requestId: 'changeover' })
  unsubscribe1()
  unsubscribe2()
  assert.deepEqual(snapshots, [])
})

const snapshot = { match: { status: 'Live', settings: { expressMode: false } }, revision: '1', canUndo: true, umpirePending: false }
const capableService = { ...courtActionService, capabilities: { start: true, correction: true, override: true, changeover: true, umpire: true } }

test('action guards depend on engine state, not court connectivity', () => {
  assert.equal(courtActionUnavailable('correction', snapshot, capableService), '')
  assert.equal(courtActionUnavailable('correction', { ...snapshot, canUndo: false }, capableService), 'Nothing to undo')
  assert.equal(courtActionUnavailable('correction', snapshot, courtActionService), missingCourtHandlers.correction)
  assert.equal(courtActionUnavailable('override', snapshot, courtActionService), missingCourtHandlers.override)
  assert.equal(courtActionUnavailable('changeover', { ...snapshot, revision: '' }, capableService), 'Waiting for match engine state')
  assert.equal(courtActionUnavailable('changeover', { ...snapshot, timer: { phase: 'changeover' } }, capableService), 'Changeover already in progress')
  assert.equal(courtActionUnavailable('changeover', { ...snapshot, match: { ...snapshot.match, settings: { expressMode: true } } }, capableService), 'Express mode skips changeovers')
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
  for (const [umpireDelivery, expected] of [['queued', 'Pending delivery'], ['delivered', 'Umpire requested'], [undefined, 'Delivery unconfirmed']]) {
    const pending = { ...snapshot, umpirePending: true, umpireDelivery }
    assert.equal(umpireRequestStatus(pending), expected)
    assert.equal(courtActionUnavailable('umpire', pending, capableService), expected)
  }
})
