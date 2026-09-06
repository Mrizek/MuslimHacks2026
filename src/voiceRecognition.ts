export type VoiceAction = 'score_team_0' | 'score_team_1' | 'correction' | 'umpire' | 'clear_umpire'

type SpeechRecognitionEventLike = { results: { length: number; [index: number]: { [index: number]: { transcript: string } } } }
type SpeechRecognitionErrorEventLike = { error: string }
type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

type BrowserWindow = Window & typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export function voiceActionFromTranscript(transcript: string): VoiceAction | null {
  const text = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/(correction|undo|correct)/.test(text)) return 'correction'
  if (/clear official/.test(text)) return 'clear_umpire'
  if (/call official/.test(text)) return 'umpire'
  if (/(team one|team 1|side one|side 1|player one|player 1)/.test(text)) return 'score_team_0'
  if (/(team two|team 2|side two|side 2|player two|player 2)/.test(text)) return 'score_team_1'
  return null
}

export function createVoiceRecognition(onAction: (action: VoiceAction) => void, onStatus: (status: string) => void) {
  const browserWindow = window as BrowserWindow
  const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition
  if (!Recognition) return null

  const recognition = new Recognition()
  recognition.continuous = true
  recognition.interimResults = false
  recognition.lang = 'en-US'
  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim()
    const action = voiceActionFromTranscript(transcript)
    onStatus(action ? `Heard: ${transcript}` : `Heard but not a command: ${transcript}`)
    if (action) onAction(action)
  }
  recognition.onerror = (event) => onStatus(event.error === 'not-allowed' ? 'Microphone permission is required' : `Voice error: ${event.error}`)
  recognition.onend = () => onStatus('Voice recognition stopped')
  return recognition
}