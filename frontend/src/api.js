export const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:8000'
).replace(/\/+$/, '')

export function resolveApiUrl(path) {
  if (!path) return ''
  if (/^(?:https?:|blob:|data:)/i.test(path)) return path
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/api/health`)
  if (!res.ok) throw new Error('Health check failed')
  return res.json()
}

export async function fetchPresets() {
  const res = await fetch(`${API_BASE}/api/presets`)
  if (!res.ok) throw new Error('Failed to load scenario presets')
  return res.json()
}

export async function fetchSubmissions(status = '', q = '') {
  const params = new URLSearchParams()
  if (status && status !== 'ALL') params.set('status', status)
  if (q && q.trim()) params.set('q', q.trim())
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${API_BASE}/api/submissions${qs}`)
  if (!res.ok) throw new Error('Failed to load audit submissions')
  return res.json()
}

export async function sendRemediationEmail(submissionId) {
  const res = await fetch(`${API_BASE}/api/submissions/${encodeURIComponent(submissionId)}/send-email`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to dispatch remediation email')
  return res.json()
}

export async function clearAllSubmissions() {
  const res = await fetch(`${API_BASE}/api/submissions`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to clear submissions')
  return res.json()
}

/**
 * Streams real-time 4-stage pipeline events from POST /api/onboard/stream.
 * Invokes onEvent({ event, ... }) as each SSE data frame arrives.
 */
export async function streamOnboarding(formData, onEvent) {
  const response = await fetch(`${API_BASE}/api/onboard/stream`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(errText || `Pipeline request failed (${response.status})`)
  }

  if (!response.body) {
    throw new Error('Streaming response body unavailable')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finalResult = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      const lines = part.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = JSON.parse(line.slice(6))
          onEvent(payload)
          if (payload.event === 'complete') {
            finalResult = payload.result
          }
        }
      }
    }
  }

  return finalResult
}
