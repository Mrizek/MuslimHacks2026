import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import './CourtDisplay.css'
import { courtsideConfig } from './config'
import { CourtControls } from './CourtControls'
import { courtActionService, sendMatchOverride, type CourtActionService, type CourtSnapshot, type MatchTimerState } from './courtActionService'
import { backendMatchService, matchFromBackend } from './matchService'
import type { BackendMatchSnapshot, Court, Match, MatchFormat, MatchSettings, Sponsor, SponsorMediaType } from './types'
import { tournamentConfig } from './types'
import { createVoiceRecognition, type VoiceAction } from './voiceRecognition'

const tabs = ['Courts', 'Matches', 'Rules', 'Sponsors']
const requiredCourtNames = ['Court 1', 'Court 2']
const defaultSettings: MatchSettings = { noAd: false, tiebreakPoints: 7, gamesPerSet: 6, tiebreakAt: 6, setsToWin: 1, expressMode: false, serveClockEnabled: true, serveClockSeconds: 25, changeoverSeconds: 90 }
const initialSponsors: Sponsor[] = []
type FormState = { courtId: string | number; format: MatchFormat; teams: [string[], string[]]; server: string; settings: MatchSettings }
const blankForm = (courtId: string | number, settings: MatchSettings = defaultSettings): FormState => ({ courtId, format: 'Doubles', teams: [['', ''], ['', '']], server: '', settings: { ...settings } })

function StatusPill({ label, live = false, offline = false, showDot = true, sponsorStatus }: { label: string; live?: boolean; offline?: boolean; showDot?: boolean; sponsorStatus?: 'enabled' | 'disabled' }) {
  return <span className={`status-pill ${live ? 'status-pill--live' : ''} ${offline ? 'status-pill--offline' : ''} ${showDot ? '' : 'status-pill--text-only'} ${sponsorStatus ? `status-pill--${sponsorStatus}` : ''}`}>{showDot && <span className="status-dot" />}{label}</span>
}

function upsertMatch(matches: Match[], next: Match) {
  return matches.some((match) => match.id === next.id) ? matches.map((match) => match.id === next.id ? next : match) : [...matches, next]
}

function loadLocal<T>(key: string, fallback: T): T {
  try { const saved = window.localStorage.getItem(key); return saved ? JSON.parse(saved) as T : fallback } catch { return fallback }
}

function validSeconds(value: number) { return Number.isInteger(value) && value > 0 }

function loadSettings(): MatchSettings {
  const saved = loadLocal<Partial<MatchSettings> & { decidingTiebreak?: boolean }>('tennis-default-settings', {})
  return {
    ...defaultSettings,
    ...saved,
    tiebreakPoints: saved.tiebreakPoints === 10 || saved.tiebreakPoints === 7 ? saved.tiebreakPoints : saved.decidingTiebreak ? 10 : defaultSettings.tiebreakPoints,
    gamesPerSet: validSeconds(Number(saved.gamesPerSet)) ? Number(saved.gamesPerSet) : defaultSettings.gamesPerSet,
    tiebreakAt: validSeconds(Number(saved.tiebreakAt)) ? Number(saved.tiebreakAt) : defaultSettings.tiebreakAt,
    setsToWin: validSeconds(Number(saved.setsToWin)) ? Number(saved.setsToWin) : defaultSettings.setsToWin,
    serveClockSeconds: validSeconds(Number(saved.serveClockSeconds)) ? Number(saved.serveClockSeconds) : defaultSettings.serveClockSeconds,
    changeoverSeconds: validSeconds(Number(saved.changeoverSeconds)) ? Number(saved.changeoverSeconds) : defaultSettings.changeoverSeconds,
  }
}

async function loadTwoCourts(): Promise<Court[]> {
  const existing = await backendMatchService.listCourts()
  if (existing.length >= requiredCourtNames.length) return existing.slice(0, requiredCourtNames.length)
  const courts = [...existing]
  for (const name of requiredCourtNames.slice(existing.length)) courts.push(await backendMatchService.createCourt(name))
  return courts
}

function useDashboardSocket(enabled: boolean, onMatches: (matches: Match[]) => void, onMatch: (match: Match) => void, onStatus: (status: string) => void) {
  useEffect(() => {
    if (!enabled) return
    let closed = false
    let reconnectTimer = 0
    let socket: WebSocket | null = null
    const connect = () => {
      onStatus('Connecting dashboard feed...')
      socket = new WebSocket(`${courtsideConfig.wsBaseUrl}/dashboard/`)
      socket.onopen = () => onStatus('Dashboard feed connected')
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ({ type: 'match_snapshot'; scope?: string; matches?: BackendMatchSnapshot[] } | ({ type: 'match_updated' } & BackendMatchSnapshot))
        if (message.type === 'match_snapshot' && Array.isArray(message.matches)) onMatches(message.matches.map(matchFromBackend))
        if (message.type === 'match_updated') onMatch(matchFromBackend(message))
      }
      socket.onerror = () => onStatus('Dashboard feed error')
      socket.onclose = () => {
        if (closed) return
        onStatus('Dashboard feed disconnected. Reconnecting...')
        reconnectTimer = window.setTimeout(connect, 1500)
      }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [enabled, onMatch, onMatches, onStatus])
}

function ChangeoverDisplay({ match, sponsors, onClose, timer }: { match: Match; sponsors: Sponsor[]; onClose?: () => void; timer?: MatchTimerState }) {
  const [remaining, setRemaining] = useState(timer?.remainingSeconds ?? match.settings.changeoverSeconds)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [sponsorIndex, setSponsorIndex] = useState(0)
  const [mediaFailed, setMediaFailed] = useState(false)
  const mediaRef = useRef<HTMLMediaElement>(null)
  const playableSponsors = (sponsors.length ? sponsors : loadLocal<Sponsor[]>('tennis-sponsors', [])).filter((sponsor) => sponsor.enabled)
  const sponsor = playableSponsors[sponsorIndex % Math.max(playableSponsors.length, 1)]
  const advanceSponsor = () => { setMediaFailed(false); setSponsorIndex((index) => index + 1) }
  const skipFailedSponsor = () => { setMediaFailed(true); if (playableSponsors.length > 1) advanceSponsor() }

  useEffect(() => {
    if (match.settings.expressMode) return
    const end = Date.now() + (timer?.remainingSeconds ?? match.settings.changeoverSeconds) * 1000
    const interval = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) { mediaRef.current?.pause(); window.clearInterval(interval) }
    }, 250)
    return () => window.clearInterval(interval)
  }, [match.settings.changeoverSeconds, match.settings.expressMode, timer?.remainingSeconds])

  const enableAudio = () => {
    try { const context = new AudioContext(); const oscillator = context.createOscillator(); oscillator.connect(context.destination); oscillator.frequency.value = 440; oscillator.start(); oscillator.stop(context.currentTime + 0.08); setAudioEnabled(true); void mediaRef.current?.play().catch(() => undefined) } catch { setAudioEnabled(false) }
  }
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0')
  const seconds = (remaining % 60).toString().padStart(2, '0')

  return <section className="changeover" aria-label="Changeover display"><div className="changeover__top"><span>{timer ? 'Match changeover' : 'Changeover'}</span>{onClose && <button className="display-button" onClick={onClose}>Back to scoreboard</button>}</div>{match.settings.expressMode ? <div className="changeover__skip"><strong>Express mode</strong><span>Rest skipped for this match.</span></div> : <><p className="changeover__label">Rest period</p><strong className="changeover__timer">{minutes}:{seconds}</strong><div className="sponsor-player">{sponsor && !mediaFailed ? <>{sponsor.mediaType === 'Image' && <img src={sponsor.mediaUrl} alt={sponsor.name} onError={skipFailedSponsor} />} {sponsor.mediaType === 'Video' && <video ref={(node) => { mediaRef.current = node }} src={sponsor.mediaUrl} autoPlay muted={!audioEnabled} onEnded={advanceSponsor} onError={skipFailedSponsor} />} {sponsor.mediaType === 'Audio' && <><audio ref={(node) => { mediaRef.current = node }} src={sponsor.mediaUrl} autoPlay onEnded={advanceSponsor} onError={skipFailedSponsor} /><span>{sponsor.name}</span></>}</> : <span>{playableSponsors.length ? 'Sponsor media could not load.' : 'No enabled sponsors for this break.'}</span>}</div><button type="button" className="audio-button" onClick={enableAudio}>{audioEnabled ? 'Audio enabled' : 'Enable audio / Play'}</button></>}</section>
}

function serverMarker(match: Match, teamIndex: number, playerIndex: number) {
  const state = match.backendState
  return state ? state.server_team === teamIndex && state.server_player === playerIndex : match.teams[teamIndex][playerIndex] === match.server
}

function serverInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 3).toUpperCase() || 'S'
}

function teamTitle(match: Match) {
  return match.teams.map((team) => team.join(' / ')).join(' vs ')
}

function leadingTeam(match: Match): 0 | 1 {
  const fields = ['sets', 'games', 'points'] as const
  for (const field of fields) {
    const first = Number.parseInt(match.scores[0][field], 10)
    const second = Number.parseInt(match.scores[1][field], 10)
    if (Number.isFinite(first) && Number.isFinite(second) && first !== second) return first > second ? 0 : 1
  }
  return 0
}

function CourtDisplay({ court, match, sponsors = [], startChangeover = false, onClose, onMatchUpdate, service = courtActionService }: { court: Court; match: Match; sponsors?: Sponsor[]; startChangeover?: boolean; onClose: () => void; onMatchUpdate: (match: Match) => void; service?: CourtActionService }) {
  const [preview, setPreview] = useState(startChangeover)
  const [snapshot, setSnapshot] = useState<CourtSnapshot>({ match, revision: '', umpirePending: Boolean(match.umpireRequested), canUndo: Boolean(match.backendState?.last_action), connected: false, initialSnapshotReady: false })
  const [voiceStatus, setVoiceStatus] = useState('Starting voice recognition...')
  const snapshotRef = useRef(snapshot)
  const voiceRecognitionRef = useRef<ReturnType<typeof createVoiceRecognition>>(null)
  const displayRef = useRef<HTMLElement>(null)
  snapshotRef.current = snapshot
  useEffect(() => {
    return service.subscribe(court.id, match.id, (next) => { setSnapshot(next); onMatchUpdate(next.match) })
  }, [court.id, match.id, service, onMatchUpdate])
  useEffect(() => {
    const handleVoiceAction = async (action: VoiceAction) => {
      const currentSnapshot = snapshotRef.current
      if (!currentSnapshot.connected || !currentSnapshot.initialSnapshotReady) {
        setVoiceStatus('Voice ready; waiting for the match connection')
        return
      }
      const result = await service.execute({
        courtId: court.id,
        matchId: match.id,
        expectedRevision: currentSnapshot.revision,
        requestId: crypto.randomUUID(),
        action,
      } as never)
      if (result.accepted) {
        setSnapshot(result.snapshot)
        onMatchUpdate(result.snapshot.match)
        setVoiceStatus(`Accepted voice command: ${action.replaceAll('_', ' ')}`)
      } else {
        setVoiceStatus(result.reason)
      }
    }

    const recognition = createVoiceRecognition(handleVoiceAction, setVoiceStatus)
    if (!recognition) {
      setVoiceStatus('Voice recognition is not supported by this browser')
      return
    }
    voiceRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      setVoiceStatus('Click Start voice and allow microphone access')
    }
    return () => {
      recognition.stop()
      voiceRecognitionRef.current = null
    }
  }, [court.id, match.id, onMatchUpdate, service])
  const current = snapshot.match
  const ready = Boolean(snapshot.connected && snapshot.initialSnapshotReady)
  const openFullscreen = async () => { try { await displayRef.current?.requestFullscreen() } catch { /* fullscreen requires user permission */ } }
  return <section ref={displayRef} className="court-display court-tablet" aria-label={`${court.name} tablet display`}>
    <header className="display-bar"><div className="display-heading"><h2>{court.name}</h2><span>{current.format} / {current.status}</span></div><StatusPill label={ready ? 'Connected' : 'Connecting'} offline={!ready} showDot={false} /><div className="display-actions"><span className="voice-status" role="status">{voiceStatus}</span><button className="display-button" onClick={() => { try { voiceRecognitionRef.current?.start(); setVoiceStatus('Starting voice recognition...') } catch { setVoiceStatus('Microphone is already starting') } }}>Start voice</button><button className="display-button" onClick={openFullscreen}>Enter fullscreen</button><button className="display-button display-button--return" onClick={onClose}>Return</button></div></header>
    {snapshot.error && <p className="court-error" role="alert">{snapshot.error}</p>}
    {!snapshot.initialSnapshotReady && <p className="court-feedback" role="status">Waiting for backend match snapshot...</p>}
    <div className="court-play-area"><div className="display-match"><table className="display-score-table"><colgroup><col className="display-team-column" /><col /><col /><col /></colgroup><thead><tr><th scope="col">Teams</th><th scope="col">Sets</th><th scope="col">Games</th><th scope="col">Points</th></tr></thead><tbody>{current.teams.map((team, index) => <tr key={index}><th scope="row"><span className="court-team-label">Team {index + 1}</span>{team.map((player, playerIndex) => <span className="court-player" key={playerIndex}>{player}{serverMarker(current, index, playerIndex) && <span className="court-server"><span aria-hidden="true">S</span> Serving</span>}</span>)}</th>{(['sets', 'games', 'points'] as const).map((field) => <td key={field}><span className={field === 'points' ? 'court-points' : ''}>{current.scores[index][field]}</span></td>)}</tr>)}</tbody></table></div>
    <aside className="serve-clock" aria-label="Match state"><span>{current.backendState?.in_tiebreak ? 'Tiebreak' : 'Server'}</span><strong>{serverInitials(current.server)}</strong><small>{current.umpireRequested ? 'Umpire requested' : current.status}</small></aside></div>
    {(preview || snapshot.timer?.phase === 'changeover') && <ChangeoverDisplay match={current} sponsors={sponsors} timer={snapshot.timer} onClose={preview ? () => setPreview(false) : undefined} />}
    <CourtControls court={court} snapshot={snapshot} service={service} onChangeover={() => setPreview((visible) => !visible)} onAccepted={(next) => { setSnapshot(next); onMatchUpdate(next.match) }} />
  </section>
}

function Scoreboard({ match }: { match: Match }) {
  return <table className="score-table"><colgroup><col className="score-table__team-column" /><col className="score-table__value-column" /><col className="score-table__value-column" /><col className="score-table__points-column" /></colgroup><thead><tr><th scope="col">Team</th><th scope="col">Sets</th><th scope="col">Games</th><th scope="col">Points</th></tr></thead><tbody>{match.teams.map((team, index) => <tr key={`${match.id}-${index}`}><th scope="row">{team.join(' / ')}</th><td><span className="score-value">{match.scores[index].sets}</span></td><td><span className="score-value">{match.scores[index].games}</span></td><td><span className="score-value points-box">{match.scores[index].points}</span></td></tr>)}</tbody></table>
}

function CourtCard({ court, match, index, onAssign, onDisplay, onEndMatch }: { court: Court; match?: Match; index: number; onAssign: () => void; onDisplay: () => void; onEndMatch: (match: Match) => void }) {
  const courtLabel = `Court ${index + 1}`
  if (!match) return <article className="court-card court-card--available"><div className="court-card__topline"><div><p className="eyebrow">{courtLabel} / {court.name}</p><h2>Ready for a match</h2></div><StatusPill label="Available" showDot={false} /></div><div className="available-state"><div className="court-mark" aria-hidden="true"><span /></div><p>No active match on this court. Previous completed matches stay in the database.</p><button type="button" className="button button--primary" onClick={onAssign}>Start new match <span aria-hidden="true">+</span></button><div className="connection-note"><StatusPill label={court.connection} offline={court.connection === 'Offline'} showDot={false} /></div></div></article>
  return <article className={`court-card ${match.status === 'Live' ? 'court-card--live' : 'court-card--scheduled'} ${match.umpireRequested ? 'court-card--umpire' : ''}`}><div className="court-card__topline"><div><p className="eyebrow">{courtLabel} / {court.name}</p><h2>{teamTitle(match)}</h2></div><StatusPill label={match.status} live={match.status === 'Live'} /></div>{match.umpireRequested && <div className="umpire-alert" role="alert">Umpire requested</div>}<div className="match-meta"><span>{match.format} match</span><span className="match-meta__actions"><StatusPill label={court.connection} offline={court.connection === 'Offline'} showDot={false} /><button type="button" className="button button--danger" onClick={() => onEndMatch(match)}>End match</button></span></div><Scoreboard match={match} /><div className="live-details"><div><span>Current server</span><strong>{match.server}</strong></div><div><span>Umpire</span><strong className={match.umpireRequested ? 'danger-text' : ''}>{match.umpireRequested ? 'Requested' : 'Clear'}</strong></div><div><span>Court</span><strong>{court.name}</strong></div></div><div className="court-card__actions"><button type="button" className="button button--display" onClick={onDisplay}>Court display</button></div></article>
}

function MatchForm({ courts, availableCourtIds, form, setForm, submitting, error, onSubmit, onCancel }: { courts: Court[]; availableCourtIds: (string | number)[]; form: FormState; setForm: (form: FormState) => void; submitting: boolean; error: string; onSubmit: () => void; onCancel: () => void }) {
  const teamSize = form.format === 'Singles' ? 1 : 2
  const availableCourts = courts.filter((court) => availableCourtIds.includes(court.id) || court.id === form.courtId)
  const setFormat = (format: MatchFormat) => {
    const nextSize = format === 'Singles' ? 1 : 2
    setForm({ ...form, format, teams: [Array(nextSize).fill('').map((_, i) => form.teams[0][i] ?? ''), Array(nextSize).fill('').map((_, i) => form.teams[1][i] ?? '')] as [string[], string[]], server: '' })
  }
  const updatePlayer = (team: 0 | 1, index: number, value: string) => { const teams = form.teams.map((players, teamIndex) => teamIndex === team ? players.map((player, playerIndex) => playerIndex === index ? value : player) : players) as [string[], string[]]; setForm({ ...form, teams, server: form.server || value }) }
  const updateSettings = (patch: Partial<MatchSettings>) => setForm({ ...form, settings: { ...form.settings, ...patch } })
  return <section className="form-panel" aria-labelledby="assign-heading"><div className="form-heading"><div><p className="kicker">New live match</p><h2 id="assign-heading">Assign a match</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close form">x</button></div><div className="form-grid"><label>Court<select value={form.courtId} onChange={(event) => setForm({ ...form, courtId: event.target.value })}>{availableCourts.map((court, index) => <option key={court.id} value={court.id}>{court.name || `Court ${index + 1}`}</option>)}</select></label><label>Match format<select value={form.format} onChange={(event) => setFormat(event.target.value as MatchFormat)}><option>Singles</option><option>Doubles</option><option>Mixed doubles</option></select></label></div><div className="player-grid"><div><p className="form-label">Team 1</p>{form.teams[0].slice(0, teamSize).map((player, index) => <input key={`team-1-${index}`} value={player} placeholder={`Player ${index + 1}`} onChange={(event) => updatePlayer(0, index, event.target.value)} />)}</div><div><p className="form-label">Team 2</p>{form.teams[1].slice(0, teamSize).map((player, index) => <input key={`team-2-${index}`} value={player} placeholder={`Player ${index + 1}`} onChange={(event) => updatePlayer(1, index, event.target.value)} />)}</div></div><label>Initial server<select value={form.server} onChange={(event) => setForm({ ...form, server: event.target.value })}><option value="">Select a player</option>{form.teams.flat().filter(Boolean).map((player) => <option key={player} value={player}>{player}</option>)}</select></label><div className="toggle-grid"><label className="toggle"><input type="checkbox" checked={form.settings.noAd} onChange={(event) => updateSettings({ noAd: event.target.checked })} /><span>No-Ad scoring</span></label><label className="toggle"><input type="checkbox" checked={form.settings.expressMode} onChange={(event) => updateSettings({ expressMode: event.target.checked })} /><span>Express mode</span></label><label className="toggle"><input type="checkbox" checked={form.settings.serveClockEnabled} onChange={(event) => updateSettings({ serveClockEnabled: event.target.checked })} /><span>Serve clock</span></label></div><div className="form-grid"><label>Games per set<input type="number" min="1" step="1" value={form.settings.gamesPerSet} onChange={(event) => updateSettings({ gamesPerSet: Number(event.target.value) })} /></label><label>Tiebreak at<input type="number" min="1" step="1" value={form.settings.tiebreakAt} onChange={(event) => updateSettings({ tiebreakAt: Number(event.target.value) })} /></label><label>Tiebreak points<select value={form.settings.tiebreakPoints} onChange={(event) => updateSettings({ tiebreakPoints: Number(event.target.value) as 7 | 10 })}><option value={7}>7</option><option value={10}>10</option></select></label><label>Sets to win<input type="number" min="1" step="1" value={form.settings.setsToWin} onChange={(event) => updateSettings({ setsToWin: Number(event.target.value) })} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button><button type="button" className="button button--primary" disabled={submitting} onClick={onSubmit}>{submitting ? 'Assigning...' : 'Assign match'}</button></div></section>
}

function MatchesView({ matches, courts, onPreview }: { matches: Match[]; courts: Court[]; onPreview: (matchId: string) => void }) {
  return <section className="dashboard-content matches-view"><div className="section-heading"><div><p className="kicker">Match list</p><h2>Match history</h2></div><span className="refresh-label">{matches.length} matches from backend</span></div><div className="match-list">{matches.map((match) => { const court = courts.find((item) => item.id === match.courtId); return <article className="match-row" key={match.id}><div><span className="eyebrow">{court?.name || match.courtId}</span><strong>{teamTitle(match)}</strong><small>Court: {court?.name || match.courtId}</small></div><span>{match.format}</span><StatusPill label={match.status} live={match.status === 'Live'} /><button type="button" className="button button--secondary" onClick={() => onPreview(match.id)}>Preview</button></article> })}</div>{matches.length === 0 && <p className="data-note"><span>i</span>No matches have been created yet.</p>}</section>
}

function RulesView({ defaults, setDefaults }: { defaults: MatchSettings; setDefaults: (settings: MatchSettings) => void }) {
  const [draft, setDraft] = useState(defaults)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const update = (patch: Partial<MatchSettings>) => { setDraft({ ...draft, ...patch }); setSaved(false) }
  const save = () => {
    if ([draft.gamesPerSet, draft.tiebreakAt, draft.setsToWin, draft.serveClockSeconds, draft.changeoverSeconds].some((value) => !validSeconds(Number(value)))) { setError('Rule and timer values must be positive whole numbers.'); return }
    if (draft.tiebreakAt < draft.gamesPerSet) { setError('Tiebreak at cannot be lower than games per set.'); return }
    setError(''); setDefaults(draft); setSaved(true)
  }
  return <section className="dashboard-content rules-view"><div className="rules-heading"><p className="kicker">Tournament defaults</p><h2>Rules & match timing</h2><p>Defaults apply when creating a new match.</p></div><div className="rules-panel"><label className="rule-toggle"><input type="checkbox" checked={draft.noAd} onChange={(event) => update({ noAd: event.target.checked })} /><span>No-Ad scoring</span></label><label className="rule-toggle"><input type="checkbox" checked={draft.serveClockEnabled} onChange={(event) => update({ serveClockEnabled: event.target.checked })} /><span>Serve clock</span></label>{draft.serveClockEnabled && <label className="rule-number">Serve clock duration (seconds)<input type="number" min="1" step="1" value={draft.serveClockSeconds} onChange={(event) => update({ serveClockSeconds: Number(event.target.value) })} /></label>}<label className="rule-toggle"><input type="checkbox" checked={draft.expressMode} onChange={(event) => update({ expressMode: event.target.checked })} /><span>Express mode</span></label><label className="rule-number">Games per set<input type="number" min="1" step="1" value={draft.gamesPerSet} onChange={(event) => update({ gamesPerSet: Number(event.target.value) })} /></label><label className="rule-number">Tiebreak at<input type="number" min="1" step="1" value={draft.tiebreakAt} onChange={(event) => update({ tiebreakAt: Number(event.target.value) })} /></label><label className="rule-number">Tiebreak points<select value={draft.tiebreakPoints} onChange={(event) => update({ tiebreakPoints: Number(event.target.value) as 7 | 10 })}><option value={7}>7</option><option value={10}>10</option></select></label><label className="rule-number">Sets to win<input type="number" min="1" step="1" value={draft.setsToWin} onChange={(event) => update({ setsToWin: Number(event.target.value) })} /></label><label className="rule-number">Changeover duration (seconds)<input type="number" min="1" step="1" disabled={draft.expressMode} value={draft.changeoverSeconds} onChange={(event) => update({ changeoverSeconds: Number(event.target.value) })} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button type="button" className="button button--primary" onClick={save}>Save defaults for new matches</button>{saved && <p className="save-confirmation" role="status">Defaults saved for new matches.</p>}</div></section>
}

type SponsorDraft = Omit<Sponsor, 'id'>
const emptySponsor: SponsorDraft = { name: '', mediaType: 'Image', mediaUrl: '', imageDurationSeconds: 10, enabled: true }
function SponsorsView({ sponsors, setSponsors, onPreview }: { sponsors: Sponsor[]; setSponsors: (sponsors: Sponsor[]) => void; onPreview: () => void }) {
  const [draft, setDraft] = useState<SponsorDraft>(emptySponsor)
  const save = () => { if (!draft.name.trim() || !/^https?:\/\/[^\s]+$/i.test(draft.mediaUrl)) return; setSponsors([...sponsors, { ...draft, id: `sponsor-${Date.now()}`, name: draft.name.trim(), mediaUrl: draft.mediaUrl.trim() }]); setDraft(emptySponsor) }
  return <section className="dashboard-content sponsors-view"><div className="sponsors-heading"><p className="kicker">Changeover playlist</p><h2>Sponsors</h2><p>Enabled sponsors play in order during changeovers.</p><button type="button" className="button button--primary" onClick={onPreview}>Preview changeover</button></div><div className="sponsor-manager"><div className="sponsor-form"><h3>Add sponsor</h3><label>Sponsor name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Media type<select value={draft.mediaType} onChange={(event) => setDraft({ ...draft, mediaType: event.target.value as SponsorMediaType })}><option>Image</option><option>Video</option><option>Audio</option></select></label><label>Hosted media URL<input type="url" value={draft.mediaUrl} placeholder="https://example.com/media" onChange={(event) => setDraft({ ...draft, mediaUrl: event.target.value })} /></label><label>Image display duration (seconds)<input type="number" min="1" step="1" value={draft.imageDurationSeconds} onChange={(event) => setDraft({ ...draft, imageDurationSeconds: Number(event.target.value) })} /></label><label className="sponsor-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled in playlist</label><div className="form-actions"><button type="button" className="button button--primary" onClick={save}>Save sponsor</button></div></div><div className="sponsor-list"><div className="sponsor-list-heading"><h3>Saved sponsors</h3></div>{sponsors.length === 0 && <p className="empty-sponsors">No sponsors saved yet.</p>}{sponsors.map((sponsor) => <article className="sponsor-item" key={sponsor.id}><div className="sponsor-preview">{sponsor.mediaType === 'Image' ? <img src={sponsor.mediaUrl} alt="" /> : sponsor.mediaType === 'Video' ? <video src={sponsor.mediaUrl} muted controls /> : <span className="audio-preview">Audio</span>}</div><div className="sponsor-info"><h4>{sponsor.name}</h4><p>{sponsor.mediaType}</p><StatusPill label={sponsor.enabled ? 'Enabled' : 'Disabled'} showDot={false} sponsorStatus={sponsor.enabled ? 'enabled' : 'disabled'} /></div></article>)}</div></div></section>
}

export function App() {
  const [activeTab, setActiveTab] = useState('Courts')
  const [courts, setCourts] = useState<Court[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [form, setForm] = useState<FormState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [feedStatus, setFeedStatus] = useState('')
  const [lastUpdated, setLastUpdated] = useState(() => new Date())
  const [displayMatchId, setDisplayMatchId] = useState<string | null>(null)
  const [defaults, setDefaults] = useState<MatchSettings>(() => loadSettings())
  const [sponsors, setSponsors] = useState<Sponsor[]>(() => loadLocal('tennis-sponsors', initialSponsors))

  useEffect(() => { try { window.localStorage.setItem('tennis-default-settings', JSON.stringify(defaults)); window.localStorage.setItem('tennis-sponsors', JSON.stringify(sponsors)) } catch { /* local persistence is optional */ } }, [defaults, sponsors])
  useEffect(() => {
    let cancelled = false
    Promise.all([loadTwoCourts(), backendMatchService.listMatches()]).then(([courtList, matchList]) => {
      if (cancelled) return
      setCourts(courtList)
      setMatches(matchList)
      setLastUpdated(new Date())
      setError('')
    }).catch((failure) => setError(failure instanceof Error ? failure.message : 'Could not load backend data.')).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  const replaceMatches = useCallback((next: Match[]) => { setMatches(next); setLastUpdated(new Date()) }, [])
  const receiveMatch = useCallback((next: Match) => { setMatches((current) => upsertMatch(current, next)); setLastUpdated(new Date()) }, [])
  const updateMatch = useCallback((match: Match) => { setMatches((current) => upsertMatch(current, match)); setLastUpdated(new Date()) }, [])
  useDashboardSocket(!loading, replaceMatches, receiveMatch, setFeedStatus)

  const occupiedCount = courts.filter((court) => matches.some((match) => match.courtId === court.id && match.status !== 'Complete')).length
  const availableCount = courts.length - occupiedCount
  const availableCourtIds = courts.filter((court) => !matches.some((match) => match.courtId === court.id && match.status !== 'Complete')).map((court) => court.id)
  const displayedMatch = displayMatchId === null ? undefined : matches.find((match) => match.id === displayMatchId)
  const displayedCourt = displayedMatch === undefined ? undefined : courts.find((court) => court.id === displayedMatch.courtId)

  const handleAssign = async () => {
    if (!form || submitting) return
    const teamSize = form.format === 'Singles' ? 1 : 2
    const teams = form.teams.map((team) => team.slice(0, teamSize).map((player) => player.trim())) as [string[], string[]]
    if (teams.flat().some((player) => !player)) { setError('Enter every player name before assigning the match.'); return }
    if (!form.server) { setError('Select the initial server.'); return }
    if ([form.settings.gamesPerSet, form.settings.tiebreakAt, form.settings.setsToWin].some((value) => !validSeconds(Number(value)))) { setError('Match rules must use positive whole numbers.'); return }
    if (form.settings.tiebreakAt < form.settings.gamesPerSet) { setError('Tiebreak at cannot be lower than games per set.'); return }
    if (matches.some((match) => match.courtId === form.courtId && match.status !== 'Complete')) { setError('That court is already assigned. Choose an available court.'); return }
    setError(''); setSubmitting(true)
    try {
      const match = await backendMatchService.createScheduledMatch({ ...form, teams })
      setMatches((current) => upsertMatch(current, match))
      setLastUpdated(new Date())
      setForm(null)
      setNotice(`${teamTitle(match)} assigned to ${courts.find((court) => court.id === match.courtId)?.name || 'court'}.`)
      setActiveTab('Courts')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Match creation failed.') } finally { setSubmitting(false) }
  }

  const handleEndMatch = async (match: Match) => {
    const winner = leadingTeam(match)
    if (!window.confirm(`End this match with ${match.teams[winner].join(' / ')} as winner?`)) return
    setError('')
    try {
      const sets = [Number(match.scores[0].sets), Number(match.scores[1].sets)] as [number, number]
      sets[winner] = Math.max(sets[winner] || 0, match.settings.setsToWin)
      const next = await sendMatchOverride(match.id, { status: 'complete', winner_team: winner, sets })
      setMatches((current) => upsertMatch(current, next))
      setNotice(`${teamTitle(next)} ended on ${courts.find((court) => court.id === next.courtId)?.name || 'court'}.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not end match.')
    }
  }

  if (activeTab === 'Sponsors') return <main className="app-shell"><section className="page-header"><h1 aria-label="CourtSide AI - Organizer" /></section><nav className="tabs" aria-label="Tournament sections">{tabs.map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>{displayedMatch && displayedCourt && <CourtDisplay key={displayedMatch.id} court={displayedCourt} match={displayedMatch} sponsors={sponsors} startChangeover onMatchUpdate={updateMatch} onClose={() => { setDisplayMatchId(null); setActiveTab('Sponsors') }} />}{!displayedMatch && <SponsorsView sponsors={sponsors} setSponsors={setSponsors} onPreview={() => matches[0] && setDisplayMatchId(matches[0].id)} />}</main>
  return <main className="app-shell"><header className="topbar"><div className="brand-lockup"><span className="brand-mark">T</span><span>COURTLINE <small>TOURNAMENT OPS</small></span></div><div className="event-context"><span className="live-indicator" /> {tournamentConfig.date} <strong>{tournamentConfig.name}</strong></div></header><section className="page-header"><div><p className="kicker">Organizer dashboard / {tournamentConfig.name}</p><h1 aria-label="CourtSide AI - Organizer">Tennis Tournament <span>(Organizer)</span></h1></div><div className="sample-badge">LIVE DATA <span>Django backend</span></div></section><nav className="tabs" aria-label="Tournament sections">{tabs.map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'tab tab--active' : 'tab'} onClick={() => { setActiveTab(tab); setNotice('') }}>{tab}</button>)}</nav>{notice && <div className="notice" role="status">{notice}</div>}{error && <div className="notice" role="alert">{error}</div>}{displayedMatch && displayedCourt && <CourtDisplay key={displayedMatch.id} court={displayedCourt} match={displayedMatch} onMatchUpdate={updateMatch} onClose={() => setDisplayMatchId(null)} />}{activeTab === 'Rules' ? <RulesView defaults={defaults} setDefaults={setDefaults} /> : activeTab === 'Matches' ? <MatchesView matches={matches} courts={courts} onPreview={(matchId) => setDisplayMatchId(matchId)} /> : <section className="dashboard-content"><div className="section-heading"><div><p className="kicker">Live overview</p><h2>Court status</h2></div><span className="refresh-label">{loading ? 'Loading backend...' : `${feedStatus || 'REST loaded'} / Last updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}</span></div><div className="summary-grid"><div className="summary-card summary-card--occupied"><span className="summary-inline-label">Occupied: {occupiedCount}/{courts.length}</span></div><div className="summary-card summary-card--available"><span className="summary-inline-label">Available: {availableCount}/{courts.length}</span></div><div className="summary-card summary-card--matches"><span className="summary-inline-label">Match history: {matches.length}</span></div></div>{form && <MatchForm courts={courts} availableCourtIds={availableCourtIds} form={form} setForm={setForm} submitting={submitting} error={error} onSubmit={handleAssign} onCancel={() => setForm(null)} />}<div className="court-grid">{courts.map((court, index) => { const activeMatch = matches.find((match) => match.courtId === court.id && match.status !== 'Complete'); return <CourtCard key={court.id} court={court} index={index} match={activeMatch} onAssign={() => { setForm(blankForm(court.id, defaults)); setError(''); setNotice('') }} onDisplay={() => activeMatch && setDisplayMatchId(activeMatch.id)} onEndMatch={handleEndMatch} /> })}</div>{!loading && courts.length === 0 && <p className="data-note"><span>i</span>Connect Firestore so Court 1 and Court 2 can be created automatically.</p>}</section>}</main>
}

export default App
