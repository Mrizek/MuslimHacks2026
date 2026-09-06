import assert from 'node:assert/strict'
import test from 'node:test'
import { courtActionService, missingCourtHandlers } from '../src/courtActionService.ts'

for (const action of ['correction', 'override', 'changeover', 'umpire']) {
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
