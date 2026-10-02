import type {
  AgentTurnResponse,
  AskEntry,
  AskResult,
  AskThread,
  ContractType,
  DocumentDetail,
  DocumentKind,
  DocumentSummary,
  Project,
} from '../types'

function apiBase(): string {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
  if (!base) {
    throw new Error('Falta VITE_API_URL. Copia .env.example a .env.local y pega la URL del API.')
  }
  return base
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || (payload && typeof payload === 'object' && 'error' in payload)) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: string }).error)
        : `El servidor respondió ${res.status}`
    throw new Error(message)
  }
  return payload as T
}

export function listProjects(): Promise<Project[]> {
  return request<{ items: Project[] }>('/projects').then((r) => r.items)
}

export function createProject(name: string): Promise<Project> {
  return request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) })
}

export function listDocuments(projectId: string): Promise<DocumentSummary[]> {
  return request<{ items: DocumentSummary[] }>(`/projects/${projectId}/documents`).then(
    (r) => r.items,
  )
}

export function createDocument(
  projectId: string,
  input: { kind?: DocumentKind; contractType?: ContractType; title?: string },
): Promise<DocumentSummary> {
  return request<DocumentSummary>(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getDocument(projectId: string, docId: string): Promise<DocumentDetail> {
  return request<DocumentDetail>(`/projects/${projectId}/documents/${docId}`)
}

export function applyDocument(
  projectId: string,
  docId: string,
  payload: {
    clauses: DocumentDetail['clauses']
    footer?: DocumentDetail['footer']
    slots?: Record<string, string>
  },
): Promise<DocumentDetail> {
  return request<DocumentDetail>(`/projects/${projectId}/documents/${docId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function postTurn(
  projectId: string,
  docId: string,
  message: string,
): Promise<AgentTurnResponse> {
  return request<AgentTurnResponse>(`/projects/${projectId}/documents/${docId}/turns`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export function listAskThreads(projectId: string): Promise<AskThread[]> {
  return request<{ items: AskThread[] }>(`/projects/${projectId}/ask`).then((r) => r.items)
}

export function createAskThread(projectId: string, title?: string): Promise<AskThread> {
  return request<AskThread>(`/projects/${projectId}/ask`, {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {}),
  })
}

export function listAskEntries(projectId: string, threadId: string): Promise<AskEntry[]> {
  return request<{ items: AskEntry[] }>(`/projects/${projectId}/ask/${threadId}`).then((r) => r.items)
}

export function postAsk(projectId: string, threadId: string, question: string): Promise<AskResult> {
  return request<AskResult>(`/projects/${projectId}/ask/${threadId}`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

export function deleteAskThread(projectId: string, threadId: string): Promise<void> {
  return request<{ ok: boolean }>(`/projects/${projectId}/ask/${threadId}`, { method: 'DELETE' }).then(
    () => undefined,
  )
}

export function clearAskThread(projectId: string, threadId: string): Promise<void> {
  return request<{ ok: boolean }>(`/projects/${projectId}/ask/${threadId}/entries`, {
    method: 'DELETE',
  }).then(() => undefined)
}
