import { useEffect, useRef, useState } from 'react'
import type { Court } from './types'
import type { CourtAction, CourtActionService, CourtSnapshot } from './courtActionService'

const managementActions: { action: CourtAction; label: string; icon: string }[] = [
  { action: 'correction', label: 'Undo', icon: 'U' },
  { action: 'override', label: 'Override', icon: 'O' },
  { action: 'changeover', label: 'Changeover', icon: 'C' },
  { action: 'umpire', label: 'Call umpire', icon: '!' },
]

export function CourtControls({ court, snapshot, service, onAccepted, onChangeover }: { court: Court; snapshot: CourtSnapshot; service: CourtActionService; onAccepted: (snapshot: CourtSnapshot) => void; onChangeover: () => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [overrideOpen, setOverrideOpen] = useState(false)
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
    if (action === 'changeover') {
      onChangeover()
      setNotice('Changeover display toggled.')
      return
    }
    if (action === 'override') {
      setOverrideOpen(true)
      return
    }
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

  const submitOverride = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (lock.current || unavailable('override') || !snapshot.match.backendState) return
    const form = new FormData(event.currentTarget)
    const points = [Number(form.get('points-0')), Number(form.get('points-1'))] as [number, number]
    const games = [Number(form.get('games-0')), Number(form.get('games-1'))] as [number, number]
    const sets = [Number(form.get('sets-0')), Number(form.get('sets-1'))] as [number, number]
    const serverValue = String(form.get('server') || '0:0').split(':').map(Number)
    if ([...points, ...games, ...sets, ...serverValue].some((value) => !Number.isInteger(value) || value < 0)) {
      setError('Override values must be whole numbers.')
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const proposed = {
        points,
        games,
        sets,
        server_team: serverValue[0] as 0 | 1,
        server_player: serverValue[1],
        receiver_team: (1 - serverValue[0]) as 0 | 1,
        receiver_player: snapshot.match.backendState.receiver_player,
        point_number: points[0] + points[1],
      }
      const context = { courtId: court.id, matchId: snapshot.match.id, expectedRevision: snapshot.revision, requestId: crypto.randomUUID() }
      const result = await service.execute({ ...context, action: 'override', proposed, reason: 'Organizer scoreboard override' })
      if (result.accepted === false) {
        setError(result.reason)
        return
      }
      onAccepted(result.snapshot)
      setOverrideOpen(false)
      setNotice('Override accepted by backend.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Override failed.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return <footer className="court-controls">
    <div className="court-feedback" role="status">{busy ? 'Waiting for acceptance...' : snapshot.umpirePending ? 'Umpire requested' : snapshot.connected ? notice : 'Socket disconnected'}</div>
    {error && <p role="alert" className="court-error">{error}</p>}
    <div className="court-action-grid court-score-grid">{([0, 1] as const).map((team) => <button key={team} className={`court-action court-action--score-team-${team}`} disabled={busy || Boolean(scoringUnavailable)} onClick={() => void execute(team === 0 ? 'score_team_0' : 'score_team_1')}><span className="court-action-title"><span aria-hidden="true">+</span>Point Team {team + 1}</span>{scoringUnavailable && <small>{scoringUnavailable}</small>}</button>)}</div>
    <div className="court-action-grid">{managementActions.map(({ action, label, icon }) => <button key={action} className={`court-action court-action--${action}`} disabled={busy || (action !== 'changeover' && Boolean(unavailable(action)))} onClick={() => void execute(action)}><span className="court-action-title"><span aria-hidden="true">{icon}</span>{label}</span>{action !== 'changeover' && unavailable(action) && <small>{unavailable(action)}</small>}</button>)}{snapshot.umpirePending && <button className="court-action court-action--clear_umpire" disabled={busy || Boolean(unavailable('clear_umpire'))} onClick={() => void execute('clear_umpire')}><span className="court-action-title"><span aria-hidden="true">X</span>Clear umpire</span></button>}</div>
    {overrideOpen && snapshot.match.backendState && <dialog className="court-dialog" open><form onSubmit={submitOverride}><h2>Override score</h2><div className="override-teams">{([0, 1] as const).map((team) => <fieldset key={team}><legend>{snapshot.match.teams[team].join(' / ')}</legend><label>Sets<input name={`sets-${team}`} type="number" min="0" defaultValue={snapshot.match.backendState?.sets[team] ?? 0} /></label><label>Games<input name={`games-${team}`} type="number" min="0" defaultValue={snapshot.match.backendState?.games[team] ?? 0} /></label><label>Points<input name={`points-${team}`} type="number" min="0" defaultValue={snapshot.match.backendState?.points[team] ?? 0} /></label></fieldset>)}</div><label className="override-server">Server<select name="server" defaultValue={`${snapshot.match.backendState.server_team}:${snapshot.match.backendState.server_player}`}>{snapshot.match.teams.map((team, teamIndex) => team.map((player, playerIndex) => <option key={`${teamIndex}:${playerIndex}`} value={`${teamIndex}:${playerIndex}`}>{player}</option>))}</select></label><div className="form-actions"><button type="button" className="button button--secondary" onClick={() => setOverrideOpen(false)}>Cancel</button><button type="submit" className="button button--primary" disabled={busy}>Apply override</button></div></form></dialog>}
  </footer>
}
