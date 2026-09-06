import { useEffect, useRef, useState } from 'react'
import type { Court } from './types'
import type { CourtAction, CourtActionService, CourtSnapshot } from './courtActionService'

const managementActions: { action: CourtAction; label: string; icon: string }[] = [
  { action: 'correction', label: 'Undo', icon: 'U' },
  { action: 'override', label: 'Override', icon: 'O' },
  { action: 'changeover', label: 'Force changeover', icon: 'C' },
  { action: 'umpire', label: 'Call umpire', icon: '!' },
]

export function CourtControls({ court, snapshot, service, onAccepted }: { court: Court; snapshot: CourtSnapshot; service: CourtActionService; onAccepted: (snapshot: CourtSnapshot) => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const lock = useRef(false)

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 6000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const scoringUnavailable = !snapshot.connected || !snapshot.initialSnapshotReady ? 'Waiting for backend snapshot' : snapshot.match.status === 'Complete' ? 'Match complete' : ''
  const unavailable = (action: CourtAction) => {
    if (scoringUnavailable) return scoringUnavailable
    if (court.connection === 'Offline') return 'Unavailable - offline'
    if (action === 'correction' && !snapshot.canUndo) return 'No scoring action to undo'
    if (action === 'umpire' && snapshot.umpirePending) return 'Umpire requested'
    if (action === 'clear_umpire' && !snapshot.umpirePending) return 'No umpire request'
    if (!service.capabilities[action]) return service.unavailableReasons?.[action] ?? 'Unavailable - not connected'
    return ''
  }

  const execute = async (action: CourtAction) => {
    if (lock.current || unavailable(action)) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const context = { courtId: court.id, matchId: snapshot.match.id, expectedRevision: snapshot.revision, requestId: crypto.randomUUID() }
      const result = await service.execute({ ...context, action } as never)
      if (result.accepted === false) {
        setError(result.reason)
        return
      }
      if (result.snapshot.match.id !== snapshot.match.id || result.snapshot.match.courtId !== court.id) throw new Error('Unexpected match response.')
      onAccepted(result.snapshot)
      setNotice(action === 'umpire' ? 'Umpire requested' : 'Backend accepted the command.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request failed. Check connection and retry.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return <footer className="court-controls">
    <div className="court-feedback" role="status">{busy ? 'Waiting for acceptance...' : snapshot.umpirePending ? 'Umpire requested' : snapshot.connected ? notice : 'Socket disconnected'}</div>
    {error && <p role="alert" className="court-error">{error}</p>}
    <div className="court-action-grid court-score-grid">{([0, 1] as const).map((team) => <button key={team} className={`court-action court-action--score-team-${team}`} disabled={busy || Boolean(scoringUnavailable)} onClick={() => void execute(team === 0 ? 'score_team_0' : 'score_team_1')}><span className="court-action-title"><span aria-hidden="true">+</span>Point Team {team + 1}</span>{scoringUnavailable && <small>{scoringUnavailable}</small>}</button>)}</div>
    <div className="court-action-grid">{managementActions.map(({ action, label, icon }) => <button key={action} className={`court-action court-action--${action}`} disabled={busy || Boolean(unavailable(action))} onClick={() => void execute(action)}><span className="court-action-title"><span aria-hidden="true">{icon}</span>{label}</span>{unavailable(action) && <small>{unavailable(action)}</small>}</button>)}{snapshot.umpirePending && <button className="court-action court-action--clear_umpire" disabled={busy || Boolean(unavailable('clear_umpire'))} onClick={() => void execute('clear_umpire')}><span className="court-action-title"><span aria-hidden="true">X</span>Clear umpire</span></button>}</div>
  </footer>
}
