import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalCourtService, secondsLeft, validateOverride } from '../src/localCourtService.ts'

function setup(settings = {}) {
  let time = 100000
  const match = { id: 'local-1', courtId: 1, format: 'Singles', teams: [['Alice'], ['Bob']], server: 'Bob', status: 'Scheduled', scores: [{ sets: '-', games: '-', points: '-' }, { sets: '-', games: '-', points: '-' }], settings: { noAd: false, decidingTiebreak: false, expressMode: false, serveClockEnabled: true, serveClockSeconds: 25, changeoverSeconds: 90, ...settings } }
  const other = { ...structuredClone(match), id: 'local-2', courtId: 2 }
  const saved = new Map([['tennis-matches', JSON.stringify([match, other])], ['tennis-sponsors', 'preserve-me']])
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }
  let service = new LocalCourtService(storage, [], () => time)
  const snapshot = () => service.snapshot(service.getMatches()[0])
  return { saved, storage, match, other, snapshot, service: () => service, advance: ms => { time += ms }, now: () => time,
    reload: () => { service = new LocalCourtService(storage, [], () => time) },
    run: (action, extra = {}) => service.execute({ action, courtId: 1, matchId: 'local-1', expectedRevision: snapshot().revision, requestId: crypto.randomUUID(), ...extra }),
  }
}
const proposal = { scores: [{ sets: '0', games: '1', points: '40' }, { sets: '0', games: '0', points: '30' }], server: 'Alice' }

test('start and overrides persist complete undo snapshots and isolate other courts', async () => {
  const x = setup()
  assert.equal((await x.run('correction')).reason, 'Nothing to undo')
  assert.equal((await x.run('start')).accepted, true)
  assert.equal(x.snapshot().match.server, 'Bob')
  assert.equal(x.snapshot().match.scores[0].points, '0')
  const before = structuredClone(x.snapshot())
  await x.run('override', { proposed: proposal, reason: '' })
  x.reload()
  assert.equal(x.snapshot().match.server, 'Alice')
  assert.equal((await x.run('correction')).accepted, true)
  assert.deepEqual(x.snapshot().match.scores, before.match.scores)
  assert.equal(x.snapshot().match.server, before.match.server)
  await x.run('correction')
  assert.equal(x.snapshot().match.status, 'Scheduled')
  assert.equal(x.snapshot().canUndo, false)
  assert.deepEqual(x.service().getMatches()[1], x.other)
  assert.equal(x.saved.get('tennis-sponsors'), 'preserve-me')
})

test('validation, stale edits and storage failures do not mutate saved state', async () => {
  const x = setup({ noAd: true }); await x.run('start')
  const before = x.saved.get('tennis-matches')
  assert.equal((await x.run('override', { proposed: { ...proposal, scores: [{ sets: '0', games: '0', points: 'AD' }, { sets: '0', games: '0', points: '40' }] }, reason: '' })).accepted, false)
  assert.equal((await x.run('override', { proposed: proposal, reason: '', expectedRevision: 'stale' })).accepted, false)
  assert.equal(x.saved.get('tennis-matches'), before)
  x.storage.setItem = () => { throw new Error('Quota exceeded') }
  assert.equal((await x.run('override', { proposed: proposal, reason: '' })).accepted, false)
  assert.equal(x.saved.get('tennis-matches'), before)
  assert.match(validateOverride(x.match, { ...proposal, server: 'Nobody' }), /current player/)
})

test('serve clock start, pause, resume, expiry and reset survive refresh', async () => {
  const x = setup(); await x.run('start')
  assert.equal(x.snapshot().serveClock.started, false)
  await x.run('clockStart'); x.advance(5000); x.reload()
  assert.equal(secondsLeft(x.snapshot().serveClock, x.now()), 20)
  await x.run('clockPause'); x.advance(30000); x.reload()
  assert.equal(x.snapshot().serveClock.started, true)
  assert.equal(secondsLeft(x.snapshot().serveClock, x.now()), 20)
  await x.run('clockStart'); x.advance(21000); x.service().tick(); x.reload()
  assert.equal(secondsLeft(x.snapshot().serveClock, x.now()), 0)
  assert.equal((await x.run('clockStart')).accepted, false)
  assert.equal(x.snapshot().match.scores[0].points, '0')
  await x.run('clockReset'); x.reload()
  assert.equal(x.snapshot().serveClock.started, false)
  assert.equal(secondsLeft(x.snapshot().serveClock, x.now()), 25)
})

test('disabled serve clock is explicitly enabled and persisted', async () => {
  const x = setup({ serveClockEnabled: false }); await x.run('start')
  assert.equal((await x.run('clockStart')).accepted, false)
  await x.run('clockEnable'); x.reload()
  assert.equal(x.snapshot().match.settings.serveClockEnabled, true)
  assert.equal((await x.run('clockStart')).accepted, true)
})

test('changeover pauses serving, warns once at 80s, expires at 90s and blocks duplicates', async () => {
  const x = setup(); await x.run('start'); await x.run('clockStart'); x.advance(3000)
  await x.run('changeover'); x.reload()
  assert.equal(x.snapshot().serveClock.remainingSeconds, 22)
  assert.equal(x.snapshot().serveClock.endsAt, null)
  assert.equal((await x.run('changeover')).accepted, false)
  x.advance(79000); assert.equal((await x.run('changeoverWarning')).accepted, false)
  x.advance(1000); assert.equal((await x.run('changeoverWarning')).accepted, true)
  x.reload(); assert.equal((await x.run('changeoverWarning')).accepted, false)
  x.advance(10000); x.service().tick()
  assert.equal(x.snapshot().timer.phase, 'serve')
  assert.equal(x.snapshot().serveClock.remainingSeconds, 22)
  const express = setup({ expressMode: true }); await express.run('start')
  assert.equal((await express.run('changeover')).accepted, false)
})

test('umpire requests are persistent local flags, shared with organizer and resolvable', async () => {
  const x = setup(); let received
  const unsubscribe = x.service().subscribeAll(matches => { received = matches })
  await x.run('umpire')
  assert.equal(received[0].localState.umpirePending, true)
  x.reload(); assert.equal(x.snapshot().umpireDelivery, 'local')
  assert.equal((await x.run('umpire')).accepted, false)
  await x.run('umpireResolve'); x.reload()
  assert.equal(x.snapshot().umpirePending, false)
  unsubscribe()
})

test('undo restores timer remaining time and saved settings/flags with scores', async () => {
  const x = setup(); await x.run('start'); await x.run('clockStart'); x.advance(4000); await x.run('umpire')
  await x.run('override', { proposed: proposal, reason: '' }); x.advance(5000)
  await x.run('umpireResolve'); await x.run('clockReset'); await x.run('correction')
  assert.equal(secondsLeft(x.snapshot().serveClock, x.now()), 21)
  assert.equal(x.snapshot().umpirePending, true)
  assert.equal(x.snapshot().match.server, 'Bob')
})
