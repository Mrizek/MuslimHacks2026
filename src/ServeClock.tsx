import { useState } from 'react'
import { courtActionUnavailable, type CourtActionService, type CourtSnapshot } from './courtActionService'
import { secondsLeft } from './localCourtService'

export function ServeClock({ snapshot, service, now }: { snapshot: CourtSnapshot; service: CourtActionService; now: number }) {
  const [error, setError] = useState('')
  const timer = snapshot.serveClock
  const remaining = timer ? secondsLeft(timer, now) : snapshot.match.settings.serveClockSeconds
  const run = async (action: 'clockStart' | 'clockPause' | 'clockReset' | 'clockEnable') => {
    const result = await service.execute({ action, courtId: snapshot.match.courtId, matchId: snapshot.match.id, expectedRevision: snapshot.revision, requestId: crypto.randomUUID() })
    setError(result.accepted ? '' : result.reason)
  }
  const button = (action: 'clockStart' | 'clockPause' | 'clockReset' | 'clockEnable', label: string, extraDisabled = false) => <button type="button" className={`display-button${action === 'clockPause' ? ' display-button--pause' : ''}`} disabled={extraDisabled || Boolean(courtActionUnavailable(action, snapshot, service))} onClick={() => void run(action)}>{label}</button>
  const enabled = snapshot.match.settings.serveClockEnabled
  return <aside className="serve-clock" aria-label="Serve clock"><span>Serve clock</span><strong>{enabled ? String(Math.max(0, remaining)).padStart(2, '0') : '—'}</strong>
    <small>{!enabled ? 'Disabled for this match' : remaining === 0 ? "Time's up" : timer?.endsAt != null ? 'Running' : timer?.started ? 'Paused' : 'Idle'}</small>
    <div className="clock-controls">{enabled ? <>{timer?.endsAt != null && remaining > 0 ? button('clockPause', 'Pause') : button('clockStart', timer?.started ? 'Resume' : 'Start', remaining === 0)}{button('clockReset', 'Reset')}</> : button('clockEnable', 'Enable')}</div>
    {error && <small role="alert">{error}</small>}
  </aside>
}
