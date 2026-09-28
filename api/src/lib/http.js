export const USER_AGENT = 'personal-dashboard/1.0'

// fetch() with a timeout and the dashboard's User-Agent. Extra headers are
// merged over the default; pass a different 'User-Agent' to override it.
export function fetchWithTimeout(url, { ms = 7000, headers = {}, ...init } = {}) {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(ms),
  })
}
