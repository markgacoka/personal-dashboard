export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

function toLogin() {
  const next = location.pathname + location.search + location.hash
  location.assign('/login?next=' + encodeURIComponent(next))
}

// Same-origin JSON fetch. A 401 from the app's API means the session ended:
// go to sign-in and come back here afterwards. /api/auth reports its own 401s.
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (res.status === 401 && path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
    toLogin()
    throw new ApiError('Signed out', 401)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data as { error?: string; message?: string }).error || (data as { message?: string }).message || `Request failed (${res.status})`
    throw new ApiError(res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : msg, res.status)
  }
  return data as T
}

export const get = <T,>(path: string) => api<T>(path)
export const post = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const put = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'PUT', json: json ?? {} })
export const patch = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'PATCH', json: json ?? {} })
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })
