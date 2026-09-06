const trimSlash = (value: string) => value.replace(/\/+$/, '')

const browserHost = globalThis.location?.hostname || '127.0.0.1'
const apiFromEnv = import.meta.env.VITE_COURTSIDE_API_BASE_URL as string | undefined
const wsFromEnv = import.meta.env.VITE_COURTSIDE_WS_BASE_URL as string | undefined

export const courtsideConfig = {
  apiBaseUrl: trimSlash(apiFromEnv || `http://${browserHost}:8000/api`),
  wsBaseUrl: trimSlash(wsFromEnv || `ws://${browserHost}:8000/ws`),
}
