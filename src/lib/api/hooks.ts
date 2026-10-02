import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './client'
import { nowIso, uid } from '../ids'
import { alignClauses, applyDecisions, clausesEqual } from '../diff'
import { useHistory } from '../useHistory'
import type {
  AskEntry,
  AskThread,
  Clause,
  ContractType,
  DocumentDetail,
  DocumentFooter,
  DocumentKind,
  DocumentReview,
  DocumentSummary,
  Project,
  Turn,
} from '../types'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

type DocSnap = {
  clauses: Clause[]
  footer?: DocumentFooter
  slots: Record<string, string>
}

function takeSnap(doc: DocumentDetail): DocSnap {
  return { clauses: doc.clauses, footer: doc.footer, slots: doc.slots }
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await api.listProjects())
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'No pude cargar los proyectos.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(async (name: string) => {
    const project = await api.createProject(name)
    setProjects((prev) => [project, ...prev])
    return project
  }, [])

  return { projects, loading, error, refresh, create }
}

export function useDocuments(projectId: string | null) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setDocuments([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setDocuments(await api.listDocuments(projectId))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'No pude cargar los documentos.'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (input: { kind?: DocumentKind; contractType?: ContractType; title?: string }) => {
      if (!projectId) throw new Error('Falta proyecto')
      const doc = await api.createDocument(projectId, input)
      setDocuments((prev) => [doc, ...prev])
      return doc
    },
    [projectId],
  )

  return { documents, loading, error, refresh, create }
}

export function useDocument(projectId: string | null, docId: string | null) {
  const [document, setDocument] = useState<DocumentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [review, setReview] = useState<DocumentReview | null>(null)
  const documentRef = useRef<DocumentDetail | null>(null)
  const savingRef = useRef(false)
  const { push, undo: popUndo, redo: popRedo, reset, canUndo, canRedo } = useHistory<DocSnap>()
  documentRef.current = document

  useEffect(() => {
    reset()
  }, [docId])

  const refresh = useCallback(async () => {
    if (!projectId || !docId) {
      setDocument(null)
      setReview(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setDocument(await api.getDocument(projectId, docId))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'No pude cargar el documento.'))
    } finally {
      setLoading(false)
    }
  }, [projectId, docId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sendTurn = useCallback(
    async (message: string) => {
      const trimmed = message.trim()
      if (!trimmed || !projectId || !docId || sending) return
      setSending(true)
      setStreamingText('')

      const userTurn: Turn = {
        id: uid('tmp'),
        role: 'user',
        content: trimmed,
        createdAt: nowIso(),
        questions: [],
        citations: [],
      }
      const accepted = review?.proposed
      if (review) setReview(null)
      setDocument((current) =>
        current
          ? {
              ...current,
              clauses: accepted ?? current.clauses,
              turns: [...current.turns, userTurn],
            }
          : current,
      )

      try {
        const result = await api.postTurn(projectId, docId, trimmed)
        const { version, ...patch } = result.document
        const assistantTurn: Turn = {
          id: uid('tmp'),
          role: 'assistant',
          content: result.text,
          createdAt: nowIso(),
          questions: result.questions,
          citations: result.citations,
          documentVersion: version,
          latencyMs: result.metrics.latencyMs,
        }
        const incoming = patch.clauses
        setDocument((current) => {
          if (!current) return current
          const hadDocument = current.clauses.length > 0
          if (incoming && hadDocument && !clausesEqual(current.clauses, incoming)) {
            const { clauses: _clauses, ...rest } = patch
            setReview({ base: current.clauses, proposed: incoming })
            return { ...current, ...rest, turns: [...current.turns, assistantTurn] }
          }
          push(takeSnap(current))
          setReview(null)
          return { ...current, ...patch, turns: [...current.turns, assistantTurn] }
        })
        setError(null)
      } catch (err) {
        const message = errorMessage(err, 'No pude contactar al agente.')
        const assistantTurn: Turn = {
          id: uid('tmp'),
          role: 'assistant',
          content: message,
          createdAt: nowIso(),
          questions: [],
          citations: [],
        }
        setDocument((current) =>
          current ? { ...current, turns: [...current.turns, assistantTurn] } : current,
        )
      } finally {
        setStreamingText('')
        setSending(false)
      }
    },
    [projectId, docId, sending, review, push],
  )

  const applyClauses = useCallback(
    async (
      clauses: Clause[],
      extra?: { footer?: DocumentDetail['footer']; slots?: Record<string, string> },
      options?: { history?: boolean },
    ) => {
      if (!projectId || !docId) return
      const current = documentRef.current
      if (options?.history !== false && current) push(takeSnap(current))
      savingRef.current = true
      setSaving(true)
      try {
        const updated = await api.applyDocument(projectId, docId, {
          clauses,
          footer: extra?.footer ?? current?.footer,
          slots: extra?.slots ?? current?.slots,
        })
        setDocument((prev) => (prev ? { ...updated, turns: prev.turns } : updated))
        setReview(null)
        setError(null)
      } catch (err) {
        setError(errorMessage(err, 'No pude guardar el documento.'))
      } finally {
        setSaving(false)
        savingRef.current = false
      }
    },
    [projectId, docId, push],
  )

  const restoreSnap = useCallback(
    async (snap: DocSnap) => {
      if (!projectId || !docId) return
      savingRef.current = true
      setSaving(true)
      try {
        const updated = await api.applyDocument(projectId, docId, snap)
        setDocument((prev) => (prev ? { ...updated, turns: prev.turns } : updated))
        setReview(null)
        setError(null)
      } catch (err) {
        setError(errorMessage(err, 'No pude guardar el documento.'))
      } finally {
        setSaving(false)
        savingRef.current = false
      }
    },
    [projectId, docId],
  )

  const undo = useCallback(async () => {
    const current = documentRef.current
    if (!current || savingRef.current) return
    const previous = popUndo(takeSnap(current))
    if (previous) await restoreSnap(previous)
  }, [popUndo, restoreSnap])

  const redo = useCallback(async () => {
    const current = documentRef.current
    if (!current || savingRef.current) return
    const next = popRedo(takeSnap(current))
    if (next) await restoreSnap(next)
  }, [popRedo, restoreSnap])

  const acceptReview = useCallback(async () => {
    if (!review) return
    await applyClauses(applyDecisions(alignClauses(review.base, review.proposed), {}, 'accept'))
  }, [review, applyClauses])

  const rejectReview = useCallback(async () => {
    if (!review) return
    await applyClauses(applyDecisions(alignClauses(review.base, review.proposed), {}, 'reject'))
  }, [review, applyClauses])

  return {
    document,
    loading,
    error,
    sending,
    saving,
    streamingText,
    review,
    sendTurn,
    applyClauses,
    acceptReview,
    rejectReview,
    undo,
    redo,
    canUndo,
    canRedo,
    refresh,
  }
}

export function useAsk(projectId: string | null) {
  const [threads, setThreads] = useState<AskThread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [entries, setEntries] = useState<AskEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  const refreshThreads = useCallback(async () => {
    if (!projectId) {
      setThreads([])
      setThreadId(null)
      setEntries([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const items = await api.listAskThreads(projectId)
      setThreads(items)
      setThreadId((current) => {
        if (current && items.some((thread) => thread.id === current)) return current
        return items[0]?.id ?? null
      })
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'No pude cargar las conversaciones.'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refreshThreads()
  }, [refreshThreads])

  useEffect(() => {
    if (!projectId || !threadId) {
      setEntries([])
      return
    }
    let cancelled = false
    void api
      .listAskEntries(projectId, threadId)
      .then((items) => {
        if (!cancelled) setEntries(items)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, 'No pude cargar la conversación.'))
      })
    return () => {
      cancelled = true
    }
  }, [projectId, threadId])

  const createThread = useCallback(async () => {
    if (!projectId) return
    const thread = await api.createAskThread(projectId)
    setThreads((prev) => [thread, ...prev])
    setThreadId(thread.id)
    setEntries([])
    return thread
  }, [projectId])

  const selectThread = useCallback((id: string) => {
    setThreadId(id)
  }, [])

  const deleteThread = useCallback(
    async (id: string) => {
      if (!projectId) return
      await api.deleteAskThread(projectId, id)
      setThreads((prev) => {
        const next = prev.filter((thread) => thread.id !== id)
        setThreadId((current) => (current === id ? (next[0]?.id ?? null) : current))
        return next
      })
      if (threadId === id) setEntries([])
    },
    [projectId, threadId],
  )

  const clearThread = useCallback(async () => {
    if (!projectId || !threadId) return
    await api.clearAskThread(projectId, threadId)
    setEntries([])
  }, [projectId, threadId])

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed || !projectId || asking) return
      setAsking(true)
      try {
        let active = threadId
        if (!active) {
          const thread = await api.createAskThread(projectId)
          setThreads((prev) => [thread, ...prev])
          setThreadId(thread.id)
          active = thread.id
        }
        const entry = await api.postAsk(projectId, active, trimmed)
        setEntries((prev) => [...prev, entry])
        setThreads((prev) =>
          prev
            .map((thread) =>
              thread.id === active
                ? {
                    ...thread,
                    title: thread.title === 'Nueva consulta' ? trimmed.slice(0, 72) : thread.title,
                    updatedAt: entry.createdAt,
                  }
                : thread,
            )
            .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || '')),
        )
        setError(null)
      } catch (err) {
        setError(errorMessage(err, 'No pude responder la consulta.'))
      } finally {
        setAsking(false)
      }
    },
    [projectId, asking, threadId],
  )

  const activeThread = threads.find((thread) => thread.id === threadId) ?? null
  return {
    threads,
    activeThread,
    threadId,
    entries,
    loading,
    error,
    asking,
    ask,
    createThread,
    selectThread,
    deleteThread,
    clearThread,
  }
}
