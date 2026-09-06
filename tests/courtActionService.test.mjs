import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

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
