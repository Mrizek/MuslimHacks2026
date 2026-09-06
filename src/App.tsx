import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import './CourtDisplay.css'
import { courtsideConfig } from './config'
import { CourtControls } from './CourtControls'
import { courtActionService, type CourtActionService, type CourtSnapshot, type MatchTimerState } from './courtActionService'
import { backendMatchService, localChangeRequestService, matchFromBackend } from './matchService'
import type { BackendMatchSnapshot, Court, Match, MatchFormat, MatchSettings, PendingChangeRequest, Sponsor, SponsorMediaType } from './types'
import { tournamentConfig } from './types'

const tabs = ['Courts', 'Matches', 'Rules', 'Sponsors']
const requiredCourtNames = ['Court 1', 'Court 2']
const defaultSettings: MatchSettings = { noAd: false, decidingTiebreak: true, expressMode: false, serveClockEnabled: true, serveClockSeconds: 25, changeoverSeconds: 90 }
const initialSponsors: Sponsor[] = []
type FormState = { courtId: string; format: MatchFormat; teams: [string[], string[]]; server: string; settings: MatchSettings }
const blankForm = (courtId: string, settings: MatchSettings = defaultSettings): FormState => ({ courtId, format: 'Doubles', teams: [['', ''], ['', '']], server: '', settings: { ...settings } })

function StatusPill({ label, live = false, offline = false, showDot = true, sponsorStatus }: { label: string; live?: boolean; offline?: boolean; showDot?: boolean; sponsorStatus?: 'enabled' | 'disabled' }) {
  return <span className={`status-pill ${live ? 'status-pill--live' : ''} ${offline ? 'status-pill--offline' : ''} ${showDot ? '' : 'status-pill--text-only'} ${sponsorStatus ? `status-pill--${sponsorStatus}` : ''}`}>{showDot && <span className="status-dot" />}{label}</span>
}

function upsertMatch(matches: Match[], next: Match) {
  return matches.some((match) => match.id === next.id) ? matches.map((match) => match.id === next.id ? next : match) : [...matches, next]
}

function loadLocal<T>(key: string, fallback: T): T {
  try { const saved = window.localStorage.getItem(key); return saved ? JSON.parse(saved) as T : fallback } catch { return fallback }
}

function loadSettings(): MatchSettings {
  const saved = loadLocal<Partial<MatchSettings>>('tennis-default-settings', {})
  return { ...defaultSettings, ...saved, serveClockSeconds: validSeconds(Number(saved.serveClockSeconds)) ? Number(saved.serveClockSeconds) : defaultSettings.serveClockSeconds, changeoverSeconds: validSeconds(Number(saved.changeoverSeconds)) ? Number(saved.changeoverSeconds) : defaultSettings.changeoverSeconds }
}

function loadPendingRequests(): PendingChangeRequest[] {
  const saved = loadLocal<unknown>('tennis-pending-requests', [])
  return Array.isArray(saved) ? saved.filter((item): item is PendingChangeRequest => Boolean(item && typeof item === 'object' && 'id' in item && 'matchIds' in item && 'requestedSettings' in item)) : []
}

function validSeconds(value: number) { return Number.isInteger(value) && value > 0 }

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
  const mediaRef = useRef<HTMLMediaElement>(null)
  const playableSponsors = (sponsors.length ? sponsors : loadLocal<Sponsor[]>('tennis-sponsors', [])).filter((sponsor) => sponsor.enabled)
  const sponsor = playableSponsors[sponsorIndex % Math.max(playableSponsors.length, 1)]

  useEffect(() => {
    if (match.settings.expressMode) return
    const end = Date.now() + (timer?.remainingSeconds ?? match.settings.changeoverSeconds) * 1000
    const interval = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) window.clearInterval(interval)
    }, 250)
    return () => window.clearInterval(interval)
  }, [match.settings.changeoverSeconds, match.settings.expressMode, timer?.remainingSeconds])

  const enableAudio = () => {
    try { const context = new AudioContext(); const oscillator = context.createOscillator(); oscillator.connect(context.destination); oscillator.frequency.value = 440; oscillator.start(); oscillator.stop(context.currentTime + 0.08); setAudioEnabled(true); void mediaRef.current?.play().catch(() => undefined) } catch { setAudioEnabled(false) }
  }
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0')
  const seconds = (remaining % 60).toString().padStart(2, '0')

  return <section className="changeover" aria-label="Changeover display"><div className="changeover__top"><span>{timer ? 'Match changeover' : 'Changeover preview'}</span>{onClose && <button className="display-button" onClick={onClose}>Back to scoreboard</button>}</div>{match.settings.expressMode ? <div className="changeover__skip"><strong>Express mode</strong><span>Rest skipped for this match.</span></div> : <><p className="changeover__label">Rest period</p><strong className="changeover__timer">{minutes}:{seconds}</strong><div className="sponsor-player">{sponsor ? <>{sponsor.mediaType === 'Image' && <img src={sponsor.mediaUrl} alt={sponsor.name} />} {sponsor.mediaType === 'Video' && <video ref={(node) => { mediaRef.current = node }} src={sponsor.mediaUrl} autoPlay muted={!audioEnabled} onEnded={() => setSponsorIndex((index) => index + 1)} />} {sponsor.mediaType === 'Audio' && <><audio ref={(node) => { mediaRef.current = node }} src={sponsor.mediaUrl} autoPlay onEnded={() => setSponsorIndex((index) => index + 1)} /><span>{sponsor.name}</span></>}</> : <span>No enabled sponsors for this break.</span>}</div><button type="button" className="audio-button" onClick={enableAudio}>{audioEnabled ? 'Audio enabled' : 'Enable audio / Play'}</button></>}</section>
}

function CourtDisplay({ court, match, sponsors = [], startChangeover = false, onClose, onMatchUpdate, service = courtActionService }: { court: Court; match: Match; sponsors?: Sponsor[]; startChangeover?: boolean; onClose: () => void; onMatchUpdate: (match: Match) => void; service?: CourtActionService }) {
  const [preview, setPreview] = useState(startChangeover)
  const [snapshot, setSnapshot] = useState<CourtSnapshot>({ match, revision: '', umpirePending: Boolean(match.umpireRequested), canUndo: Boolean(match.backendState?.last_action), connected: false, initialSnapshotReady: false })
  const displayRef = useRef<HTMLElement>(null)
  useEffect(() => {
    return service.subscribe(court.id, match.id, (next) => { setSnapshot(next); onMatchUpdate(next.match) })
  }, [court.id, match.id, service, onMatchUpdate])
  const current = snapshot.match
  const ready = snapshot.connected && snapshot.initialSnapshotReady
  const openFullscreen = async () => { try { await displayRef.current?.requestFullscreen() } catch { /* fullscreen requires user permission */ } }
  return <section ref={displayRef} className="court-display court-tablet" aria-label={`${court.name} tablet display`}>
    <header className="display-bar"><div className="display-heading"><h2>{court.name}</h2><span>{current.format} / {current.status}</span></div><StatusPill label={ready ? 'Connected' : 'Connecting'} offline={!ready} showDot={false} /><div className="display-actions"><button className="display-button" onClick={openFullscreen}>Enter fullscreen</button><button className="display-button display-button--return" onClick={onClose}>Return</button></div></header>
    {snapshot.error && <p className="court-error" role="alert">{snapshot.error}</p>}
    {!snapshot.initialSnapshotReady && <p className="court-feedback" role="status">Waiting for backend match snapshot...</p>}
    <div className="court-play-area"><div className="display-match"><table className="display-score-table"><colgroup><col className="display-team-column" /><col /><col /><col /></colgroup><thead><tr><th scope="col">Teams</th><th scope="col">Sets</th><th scope="col">Games</th><th scope="col">Points</th></tr></thead><tbody>{current.teams.map((team, index) => <tr key={index}><th scope="row"><span className="court-team-label">Team {index + 1}</span>{team.map((player, playerIndex) => <span className="court-player" key={playerIndex}>{player}{player === current.server && <span className="court-server"><span aria-hidden="true">S</span> Serving</span>}</span>)}</th>{(['sets', 'games', 'points'] as const).map((field) => <td key={field}><span className={field === 'points' ? 'court-points' : ''}>{current.scores[index][field]}</span></td>)}</tr>)}</tbody></table></div>
    <aside className="serve-clock" aria-label="Match state"><span>{current.backendState?.in_tiebreak ? 'Tiebreak' : 'Server'}</span><strong>{current.server.slice(0, 2).toUpperCase()}</strong><small>{current.umpireRequested ? 'Umpire requested' : current.status}</small></aside></div>
    {(preview || snapshot.timer?.phase === 'changeover') && <ChangeoverDisplay match={current} sponsors={sponsors} timer={snapshot.timer} onClose={preview ? () => setPreview(false) : undefined} />}
    {!preview && <button className="display-button court-preview" onClick={() => setPreview(true)}>Preview changeover</button>}
    <CourtControls court={court} snapshot={snapshot} service={service} onAccepted={(next) => { setSnapshot(next); onMatchUpdate(next.match) }} />
  </section>
}

function Scoreboard({ match }: { match: Match }) {
  return <table className="score-table"><colgroup><col className="score-table__team-column" /><col className="score-table__value-column" /><col className="score-table__value-column" /><col className="score-table__points-column" /></colgroup><thead><tr><th scope="col">Team</th><th scope="col">Sets</th><th scope="col">Games</th><th scope="col">Points</th></tr></thead><tbody>{match.teams.map((team, index) => <tr key={`${match.id}-${index}`}><th scope="row">{team.join(' / ')}</th><td><span className="score-value">{match.scores[index].sets}</span></td><td><span className="score-value">{match.scores[index].games}</span></td><td><span className="score-value points-box">{match.scores[index].points}</span></td></tr>)}</tbody></table>
}

function CourtCard({ court, match, index, onAssign, onDisplay }: { court: Court; match?: Match; index: number; onAssign: () => void; onDisplay: () => void }) {
  const courtLabel = `Court ${index + 1}`
  if (!match) return <article className="court-card court-card--available"><div className="court-card__topline"><div><p className="eyebrow">{courtLabel} / {court.name}</p><h2>Ready for a match</h2></div><StatusPill label="Available" showDot={false} /></div><div className="available-state"><div className="court-mark" aria-hidden="true"><span /></div><p>No active match on this court. Previous completed matches stay in the database.</p><button type="button" className="button button--primary" onClick={onAssign}>Start new match <span aria-hidden="true">+</span></button><div className="connection-note"><StatusPill label={court.connection} offline={court.connection === 'Offline'} showDot={false} /></div></div></article>
  return <article className={`court-card ${match.status === 'Live' ? 'court-card--live' : 'court-card--scheduled'}`}><div className="court-card__topline"><div><p className="eyebrow">{courtLabel} / {court.name}</p><h2>{match.teams.map((team) => team.join(' / ')).join(' vs ')}</h2></div><StatusPill label={match.status} live={match.status === 'Live'} /></div><div className="match-meta"><span>{match.format} match</span><StatusPill label={court.connection} offline={court.connection === 'Offline'} showDot={false} /></div><Scoreboard match={match} /><div className="live-details"><div><span>Current server</span><strong>{match.server}</strong></div><div><span>Umpire</span><strong>{match.umpireRequested ? 'Requested' : 'Clear'}</strong></div><div><span>Match ID</span><strong>{match.id}</strong></div></div><div className="court-card__actions"><button type="button" className="button button--display" onClick={onDisplay}>Court display</button></div></article>
}

function MatchForm({ courts, availableCourtIds, form, setForm, submitting, error, onSubmit, onCancel }: { courts: Court[]; availableCourtIds: string[]; form: FormState; setForm: (form: FormState) => void; submitting: boolean; error: string; onSubmit: () => void; onCancel: () => void }) {
  const teamSize = form.format === 'Singles' ? 1 : 2
  const availableCourts = courts.filter((court) => availableCourtIds.includes(court.id) || court.id === form.courtId)
  const setFormat = (format: MatchFormat) => setForm({ ...form, format, teams: [Array(teamSize).fill('').map((_, i) => form.teams[0][i] ?? ''), Array(teamSize).fill('').map((_, i) => form.teams[1][i] ?? '')] as [string[], string[]], server: '' })
  const updatePlayer = (team: 0 | 1, index: number, value: string) => { const teams = form.teams.map((players, teamIndex) => teamIndex === team ? players.map((player, playerIndex) => playerIndex === index ? value : player) : players) as [string[], string[]]; setForm({ ...form, teams, server: form.server || value }) }
  return <section className="form-panel" aria-labelledby="assign-heading"><div className="form-heading"><div><p className="kicker">New live match</p><h2 id="assign-heading">Assign a match</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close form">x</button></div><div className="form-grid"><label>Court<select value={form.courtId} onChange={(event) => setForm({ ...form, courtId: event.target.value })}>{availableCourts.map((court, index) => <option key={court.id} value={court.id}>{court.name || `Court ${index + 1}`}</option>)}</select></label><label>Match format<select value={form.format} onChange={(event) => setFormat(event.target.value as MatchFormat)}><option>Singles</option><option>Doubles</option><option>Mixed doubles</option></select></label></div><div className="player-grid"><div><p className="form-label">Team 1</p>{form.teams[0].map((player, index) => <input key={`team-1-${index}`} value={player} placeholder={`Player ${index + 1}`} onChange={(event) => updatePlayer(0, index, event.target.value)} />)}</div><div><p className="form-label">Team 2</p>{form.teams[1].map((player, index) => <input key={`team-2-${index}`} value={player} placeholder={`Player ${index + 1}`} onChange={(event) => updatePlayer(1, index, event.target.value)} />)}</div></div><label>Initial server<select value={form.server} onChange={(event) => setForm({ ...form, server: event.target.value })}><option value="">Select a player</option>{form.teams.flat().filter(Boolean).map((player) => <option key={player} value={player}>{player}</option>)}</select></label><div className="toggle-grid">{[['noAd', 'No-Ad scoring'], ['decidingTiebreak', '10-point tiebreak'], ['expressMode', 'Express mode']].map(([key, label]) => <label className="toggle" key={key}><input type="checkbox" checked={form.settings[key as keyof MatchSettings] === true} onChange={(event) => setForm({ ...form, settings: { ...form.settings, [key]: event.target.checked } })} /><span>{label}</span></label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button><button type="button" className="button button--primary" disabled={submitting} onClick={onSubmit}>{submitting ? 'Assigning...' : 'Assign match'}</button></div></section>
}

function MatchesView({ matches }: { matches: Match[] }) {
  return <section className="dashboard-content matches-view"><div className="section-heading"><div><p className="kicker">Match list</p><h2>Match history</h2></div><span className="refresh-label">{matches.length} matches from backend</span></div><div className="match-list">{matches.map((match) => <article className="match-row" key={match.id}><div><span className="eyebrow">{match.id} / {match.courtId}</span><strong>{match.teams.map((team) => team.join(' / ')).join(' vs ')}</strong></div><span>{match.format}</span><StatusPill label={match.status} live={match.status === 'Live'} /></article>)}</div>{matches.length === 0 && <p className="data-note"><span>i</span>No matches have been created yet.</p>}</section>
}

function RulesView({ defaults, setDefaults, matches, pending, onRequest }: { defaults: MatchSettings; setDefaults: (settings: MatchSettings) => void; matches: Match[]; pending: PendingChangeRequest[]; onRequest: (settings: MatchSettings, matchIds: string[]) => void }) {
  const [draft, setDraft] = useState(defaults)
  const [saved, setSaved] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const update = (patch: Partial<MatchSettings>) => { setDraft({ ...draft, ...patch }); setSaved(false) }
  const save = () => { if ((draft.serveClockEnabled && !validSeconds(draft.serveClockSeconds)) || (!draft.expressMode && !validSeconds(draft.changeoverSeconds))) { setError('Timer values must be positive whole numbers.'); return } setError(''); setDefaults(draft); setSaved(true) }
  const submitRequest = () => { if (!selected.length) { setError('Select at least one active match.'); return } setError(''); onRequest(defaults, selected); setSelected([]) }
  return <section className="dashboard-content rules-view"><div className="rules-heading"><p className="kicker">Tournament defaults</p><h2>Rules & match timing</h2><p>Defaults apply to new matches. Existing match scoring stays in the backend engine.</p></div><div className="rules-panel"><label className="rule-toggle"><input type="checkbox" checked={draft.noAd} onChange={(event) => update({ noAd: event.target.checked })} /><span>No-Ad scoring</span></label><label className="rule-toggle"><input type="checkbox" checked={draft.decidingTiebreak} onChange={(event) => update({ decidingTiebreak: event.target.checked })} /><span>10-point tiebreak</span></label><label className="rule-toggle"><input type="checkbox" checked={draft.serveClockEnabled} onChange={(event) => update({ serveClockEnabled: event.target.checked })} /><span>Serve clock</span></label>{draft.serveClockEnabled && <label className="rule-number">Serve clock duration (seconds)<input type="number" min="1" step="1" value={draft.serveClockSeconds} onChange={(event) => update({ serveClockSeconds: Number(event.target.value) })} /></label>}<label className="rule-toggle"><input type="checkbox" checked={draft.expressMode} onChange={(event) => update({ expressMode: event.target.checked })} /><span>Express mode</span></label><label className="rule-number">Changeover duration (seconds)<input type="number" min="1" step="1" disabled={draft.expressMode} value={draft.changeoverSeconds} onChange={(event) => update({ changeoverSeconds: Number(event.target.value) })} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button type="button" className="button button--primary" onClick={save}>Save defaults for new matches</button>{saved && <p className="save-confirmation" role="status">Defaults saved for new matches.</p>}</div><div className="request-panel"><div><p className="kicker">Local organizer notes</p><h2>Pending change requests</h2></div>{matches.map((match) => <label className="match-select" key={match.id}><input type="checkbox" checked={selected.includes(match.id)} onChange={() => setSelected((ids) => ids.includes(match.id) ? ids.filter((item) => item !== match.id) : [...ids, match.id])} /><span><strong>{match.id}</strong>{match.teams.map((team) => team.join(' / ')).join(' vs ')}</span></label>)}<button type="button" className="button button--secondary" onClick={submitRequest}>Submit request</button>{pending.map((request) => <p className="pending-request" key={request.id}>Pending court confirmation. {request.matchIds.length} match{request.matchIds.length === 1 ? '' : 'es'} affected.</p>)}</div></section>
}

type SponsorDraft = Omit<Sponsor, 'id'>
const emptySponsor: SponsorDraft = { name: '', mediaType: 'Image', mediaUrl: '', imageDurationSeconds: 10, enabled: true }
function SponsorsView({ sponsors, setSponsors, onPreview }: { sponsors: Sponsor[]; setSponsors: (sponsors: Sponsor[]) => void; onPreview: () => void }) {
  const [draft, setDraft] = useState<SponsorDraft>(emptySponsor)
  const save = () => { if (!draft.name.trim() || !/^https?:\/\/[^\s]+$/i.test(draft.mediaUrl)) return; setSponsors([...sponsors, { ...draft, id: `sponsor-${Date.now()}`, name: draft.name.trim(), mediaUrl: draft.mediaUrl.trim() }]); setDraft(emptySponsor) }
  return <section className="dashboard-content sponsors-view"><div className="sponsors-heading"><p className="kicker">Changeover playlist</p><h2>Sponsors</h2><p>Enabled sponsors play in order during changeover previews.</p><button type="button" className="button button--primary" onClick={onPreview}>Preview changeover</button></div><div className="sponsor-manager"><div className="sponsor-form"><h3>Add sponsor</h3><label>Sponsor name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Media type<select value={draft.mediaType} onChange={(event) => setDraft({ ...draft, mediaType: event.target.value as SponsorMediaType })}><option>Image</option><option>Video</option><option>Audio</option></select></label><label>Hosted media URL<input type="url" value={draft.mediaUrl} placeholder="https://example.com/media" onChange={(event) => setDraft({ ...draft, mediaUrl: event.target.value })} /></label><label>Image display duration (seconds)<input type="number" min="1" step="1" value={draft.imageDurationSeconds} onChange={(event) => setDraft({ ...draft, imageDurationSeconds: Number(event.target.value) })} /></label><label className="sponsor-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled in playlist</label><div className="form-actions"><button type="button" className="button button--primary" onClick={save}>Save sponsor</button></div></div><div className="sponsor-list"><div className="sponsor-list-heading"><h3>Saved sponsors</h3></div>{sponsors.length === 0 && <p className="empty-sponsors">No sponsors saved yet.</p>}{sponsors.map((sponsor) => <article className="sponsor-item" key={sponsor.id}><div className="sponsor-preview">{sponsor.mediaType === 'Image' ? <img src={sponsor.mediaUrl} alt="" /> : sponsor.mediaType === 'Video' ? <video src={sponsor.mediaUrl} muted controls /> : <span className="audio-preview">Audio</span>}</div><div className="sponsor-info"><h4>{sponsor.name}</h4><p>{sponsor.mediaType}</p><StatusPill label={sponsor.enabled ? 'Enabled' : 'Disabled'} showDot={false} sponsorStatus={sponsor.enabled ? 'enabled' : 'disabled'} /></div></article>)}</div></div></section>
}

function App() {
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
  const [displayCourtId, setDisplayCourtId] = useState<string | null>(null)
  const [defaults, setDefaults] = useState<MatchSettings>(() => loadSettings())
  const [pending, setPending] = useState<PendingChangeRequest[]>(() => loadPendingRequests())
  const [sponsors, setSponsors] = useState<Sponsor[]>(() => loadLocal('tennis-sponsors', initialSponsors))

  useEffect(() => { try { window.localStorage.setItem('tennis-default-settings', JSON.stringify(defaults)); window.localStorage.setItem('tennis-pending-requests', JSON.stringify(pending)); window.localStorage.setItem('tennis-sponsors', JSON.stringify(sponsors)) } catch { /* local persistence is optional */ } }, [defaults, pending, sponsors])
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
  const displayedMatch = displayCourtId === null ? undefined : matches.find((match) => match.courtId === displayCourtId)
  const displayedCourt = displayCourtId === null ? undefined : courts.find((court) => court.id === displayCourtId)

  const handleAssign = async () => {
    if (!form || submitting) return
    const teamSize = form.format === 'Singles' ? 1 : 2
    const teams = form.teams.map((team) => team.slice(0, teamSize).map((player) => player.trim())) as [string[], string[]]
    if (teams.flat().some((player) => !player)) { setError('Enter every player name before assigning the match.'); return }
    if (!form.server) { setError('Select the initial server.'); return }
    if (matches.some((match) => match.courtId === form.courtId && match.status !== 'Complete')) { setError('That court is already assigned. Choose an available court.'); return }
    setError(''); setSubmitting(true)
    try {
      const match = await backendMatchService.createScheduledMatch({ ...form, teams })
      setMatches((current) => upsertMatch(current, match))
      setLastUpdated(new Date())
      setForm(null)
      setNotice(`${match.id} assigned to ${courts.find((court) => court.id === match.courtId)?.name || 'court'}.`)
      setActiveTab('Courts')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Match creation failed.') } finally { setSubmitting(false) }
  }
  const handleRequest = async (settings: MatchSettings, matchIds: string[]) => { const request = await localChangeRequestService.createChangeRequest(matchIds, settings); setPending((current) => [...current, request]); setNotice('Change request saved locally. Backend scoring is unchanged.') }
  if (activeTab === 'Sponsors') return <main className="app-shell"><section className="page-header"><h1 aria-label="CourtSide AI - Organizer" /></section><nav className="tabs" aria-label="Tournament sections">{tabs.map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>{displayedMatch && displayedCourt && <CourtDisplay key={displayedMatch.id} court={displayedCourt} match={displayedMatch} sponsors={sponsors} startChangeover onMatchUpdate={updateMatch} onClose={() => { setDisplayCourtId(null); setActiveTab('Sponsors') }} />}{!displayedMatch && <SponsorsView sponsors={sponsors} setSponsors={setSponsors} onPreview={() => courts[0] && setDisplayCourtId(courts[0].id)} />}</main>
  return <main className="app-shell"><header className="topbar"><div className="brand-lockup"><span className="brand-mark">T</span><span>COURTLINE <small>TOURNAMENT OPS</small></span></div><div className="event-context"><span className="live-indicator" /> {tournamentConfig.date} <strong>{tournamentConfig.name}</strong></div></header><section className="page-header"><div><p className="kicker">Organizer dashboard / {tournamentConfig.name}</p><h1>Tennis Tournament <span>(Organizer)</span></h1></div><div className="sample-badge">LIVE DATA <span>Django backend</span></div></section><nav className="tabs" aria-label="Tournament sections">{tabs.map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'tab tab--active' : 'tab'} onClick={() => { setActiveTab(tab); setNotice('') }}>{tab}</button>)}</nav>{notice && <div className="notice" role="status">{notice}</div>}{error && <div className="notice" role="alert">{error}</div>}{displayedMatch && displayedCourt && <CourtDisplay key={displayedMatch.id} court={displayedCourt} match={displayedMatch} onMatchUpdate={updateMatch} onClose={() => setDisplayCourtId(null)} />}{activeTab === 'Rules' ? <RulesView defaults={defaults} setDefaults={setDefaults} matches={matches} pending={pending} onRequest={handleRequest} /> : activeTab === 'Matches' ? <MatchesView matches={matches} /> : <section className="dashboard-content"><div className="section-heading"><div><p className="kicker">Live overview</p><h2>Court status</h2></div><span className="refresh-label">{loading ? 'Loading backend...' : `${feedStatus || 'REST loaded'} / Last updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}</span></div><div className="summary-grid"><div className="summary-card summary-card--occupied"><span className="summary-inline-label">Occupied: {occupiedCount}/{courts.length}</span></div><div className="summary-card summary-card--available"><span className="summary-inline-label">Available: {availableCount}/{courts.length}</span></div><div className="summary-card summary-card--matches"><span className="summary-inline-label">Match history: {matches.length}</span></div></div>{form && <MatchForm courts={courts} availableCourtIds={availableCourtIds} form={form} setForm={setForm} submitting={submitting} error={error} onSubmit={handleAssign} onCancel={() => setForm(null)} />}<div className="court-grid">{courts.map((court, index) => <CourtCard key={court.id} court={court} index={index} match={matches.find((match) => match.courtId === court.id && match.status !== 'Complete')} onAssign={() => { setForm(blankForm(court.id, defaults)); setError(''); setNotice('') }} onDisplay={() => setDisplayCourtId(court.id)} />)}</div>{!loading && courts.length === 0 && <p className="data-note"><span>i</span>Connect Firestore so Court 1 and Court 2 can be created automatically.</p>}</section>}</main>
}

export default App
