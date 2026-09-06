import { useEffect, useRef, useState } from 'react'
import type { Court, Match } from './types'
import { courtActionUnavailable, umpireRequestStatus } from './courtActionService'
import type { CourtAction, CourtActionService, CourtSnapshot, OverrideProposal } from './courtActionService'

const actions: { action: CourtAction; label: string; icon: string }[] = [
  { action: 'correction', label: 'Correction', icon: '↶' },
  { action: 'override', label: 'Override', icon: '✎' },
  { action: 'changeover', label: 'Force changeover', icon: '⇄' },
  { action: 'umpire', label: 'Call umpire', icon: '⚑' },
]
const fields = ['sets', 'games', 'points'] as const

export function CourtControls({ court, snapshot, service, onAccepted }: { court: Court; snapshot: CourtSnapshot; service: CourtActionService; onAccepted: (snapshot: CourtSnapshot) => void }) {
  const [dialog, setDialog] = useState<'override' | 'changeover' | null>(null)
  const [proposed, setProposed] = useState<OverrideProposal>({ scores: snapshot.match.scores, server: snapshot.match.server })
  const [reason, setReason] = useState('')
  const [revision, setRevision] = useState(snapshot.revision)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const modal = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timeout) }, [notice])
  useEffect(() => { if (dialog) modal.current?.showModal(); else { modal.current?.close(); trigger.current?.focus() } }, [dialog])
  const unavailable = (action: CourtAction) => courtActionUnavailable(action, snapshot, service)
  const execute = async (action: CourtAction) => {
    if (lock.current || unavailable(action)) return
    if (dialog && revision !== snapshot.revision) { setError('Match changed. Cancel and review the latest values.'); return }
    if (action === 'override' && (!snapshot.match.teams.flat().includes(proposed.server) || proposed.scores.some((score) => fields.some((field) => !score[field].trim())))) { setError('Enter every proposed score and a valid server.'); return }
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const context = { courtId: court.id, matchId: snapshot.match.id, expectedRevision: snapshot.revision, requestId: crypto.randomUUID() }
      const result = await service.execute(action === 'override' ? { ...context, action, proposed, reason: reason.trim() } : { ...context, action })
      if (!result.accepted) { setError(result.reason); return }
      if (result.snapshot.match.id !== snapshot.match.id || result.snapshot.match.courtId !== court.id) throw new Error('Unexpected match response.')
      onAccepted(result.snapshot)
      setNotice(action === 'umpire' ? umpireRequestStatus(result.snapshot) || result.description : result.description)
      setDialog(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Request failed. Check connection and retry.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <footer className="court-controls">
    <div className="court-feedback" role="status">{busy ? 'Saving locally…' : snapshot.umpirePending ? umpireRequestStatus(snapshot) : notice}</div>
    {!dialog && error && <p role="alert" className="court-error">{error}</p>}
    {snapshot.match.status === 'Scheduled' && <div className="court-start"><button className="display-button" disabled={busy || Boolean(unavailable('start'))} onClick={() => void execute('start')}>Start match</button>{unavailable('start') && <span>{unavailable('start')}</span>}</div>}
    <div className="court-action-grid">{actions.map(({ action, label, icon }) => <button key={action} className={`court-action court-action--${action}`} disabled={busy || Boolean(unavailable(action))} onClick={(event) => {
      trigger.current = event.currentTarget
      if (action === 'override' || action === 'changeover') { setProposed({ scores: snapshot.match.scores.map((score) => ({ ...score })) as Match['scores'], server: snapshot.match.server }); setReason(''); setRevision(snapshot.revision); setError(''); setDialog(action) }
      else void execute(action)
    }}><span className="court-action-title"><span aria-hidden="true">{icon}</span>{label}</span>{unavailable(action) && <small>{unavailable(action)}</small>}</button>)}</div>
    <dialog ref={modal} className="court-dialog" aria-labelledby="court-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) setDialog(null) }}>
      <h2 id="court-dialog-title">{dialog === 'override' ? 'Edit local score' : 'Confirm force changeover'}</h2>
      <p>Court {court.id} · {snapshot.match.id}</p>
      {dialog === 'override' ? <><p>Review the current and proposed values. Confirmation saves this edit in this browser.</p><div className="override-teams">{snapshot.match.teams.map((team, index) => <fieldset key={index}><legend>Team {index + 1}: {team.join(' / ')}</legend>{fields.map((field) => <label key={field}><span>{field}<small>Current: {snapshot.match.scores[index][field]}</small></span><input aria-label={`Team ${index + 1} proposed ${field}`} value={proposed.scores[index][field]} disabled={busy} onChange={(event) => setProposed((current) => ({ ...current, scores: current.scores.map((score, i) => i === index ? { ...score, [field]: event.target.value } : score) as Match['scores'] }))} /></label>)}</fieldset>)}</div><label className="override-detail">Proposed server <small>Current: {snapshot.match.server}</small><select value={proposed.server} disabled={busy} onChange={(event) => setProposed({ ...proposed, server: event.target.value })}>{snapshot.match.teams.flat().map((player, index) => <option key={index} value={player}>{player}</option>)}</select></label><label className="override-detail">Note (optional)<textarea value={reason} disabled={busy} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label></> : <p>Start the changeover countdown and sponsor playlist for this court?</p>}
      {busy && <p role="status">Saving locally…</p>}
      {error && <p className="court-error" role="alert">{error}</p>}
      <div className="court-dialog-actions"><button className="display-button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className="display-button" disabled={busy || !dialog || Boolean(dialog && unavailable(dialog)) || (dialog === 'override' && (proposed.scores.some((score) => fields.some((field) => !score[field].trim()))))} onClick={() => dialog && void execute(dialog)}>{busy ? 'Saving locally…' : dialog === 'override' ? 'Confirm proposed values' : 'Start changeover'}</button></div>
    </dialog>
  </footer>
}
