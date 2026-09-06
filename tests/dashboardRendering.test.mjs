import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('backend dashboard shell renders without backend access or a mode selector during SSR', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const savedMatch = {
    id: 'saved-match', courtId: 2, format: 'Singles', teams: [['Saved Alice'], ['Saved Bob']],
    server: 'Saved Alice', status: 'Scheduled',
    settings: { noAd: false, decidingTiebreak: true, expressMode: false, serveClockEnabled: true, serveClockSeconds: 25, changeoverSeconds: 90 },
    scores: [{ sets: '-', games: '-', points: '-' }, { sets: '-', games: '-', points: '-' }],
  }
  const storage = new Map([['tennis-matches', JSON.stringify([savedMatch])]])
  let requests = 0
  globalThis.fetch = async () => { requests++; throw new Error('Backend stopped') }
  globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: () => { throw new Error('Rendering must not rewrite saved data') } } }
  try {
    const { App } = await server.ssrLoadModule('/src/App.tsx')
    {
      const html = renderToStaticMarkup(createElement(App))
      assert.equal((html.match(/class="app-shell"/g) ?? []).length, 1)
      assert.match(html, /aria-label="CourtSide AI - Organizer"/)
      assert.match(html, /aria-label="Tournament sections"/)
      for (const tab of ['Courts', 'Matches', 'Rules', 'Sponsors']) assert.ok(html.includes(`>${tab}</button>`))
      assert.doesNotMatch(html, /local-demo-indicator|>Local demo</)
      assert.doesNotMatch(html, /Backend matches|Match data source|Reconnect|Connected|Offline|not connected/)
      assert.doesNotMatch(html, /class="tabs app-shell"/)
      assert.match(html, /Court status/)
      assert.match(html, /Loading backend/)
    }
    assert.equal(requests, 0, 'Local rendering must not wait for or contact the backend')
    assert.equal(storage.get('tennis-matches'), JSON.stringify([savedMatch]))
    const { ServeClock } = await server.ssrLoadModule('/src/ServeClock.tsx')
    const clockService = { capabilities: { clockStart: true, clockPause: true, clockReset: true, clockEnable: true } }
    for (const [started, remainingSeconds, label] of [[false, 25, 'Idle'], [true, 20, 'Paused'], [true, 0, 'Time&#x27;s up']]) {
      const clock = { phase: 'serve', endsAt: null, remainingSeconds, started }
      const snapshot = { match: { ...savedMatch, status: 'Live' }, revision: '0', canUndo: false, umpirePending: false, serveClock: clock, timer: clock }
      const html = renderToStaticMarkup(createElement(ServeClock, { snapshot, service: clockService, now: 100000 }))
      assert.ok(html.includes(label), `Expected ${label}`)
      assert.doesNotMatch(html, /Ready \/ paused/)
      if (remainingSeconds === 0) assert.match(html, /disabled=""[^>]*>Resume<\/button>/)
    }
  } finally {
    globalThis.window = previousWindow
    globalThis.fetch = previousFetch
    await server.close()
  }
})
