import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAsk } from '../../lib/api/hooks'
import { formatClock } from '../../lib/ids'
import { AutoGrowTextarea } from '../shared/AutoGrowTextarea'
import { Citations } from '../shared/Citations'

const RAIL_KEY = 'micasa:ask-rail'

const EXAMPLES = [
  {
    id: 'deposito',
    label: 'Depósito de la renta',
    question:
      '¿Cuánto depósito en garantía puede pedir el arrendador en una renta de casa habitación en Yucatán?',
  },
  {
    id: 'impago',
    label: 'Inquilino que no paga',
    question:
      'Mi inquilino lleva tres meses sin pagar la renta de un departamento en el Centro de Mérida y no quiere desocupar. ¿Qué permite el Código Civil de Yucatán?',
  },
] as const

export function AskPanel({ projectId }: { projectId: string }) {
  const {
    threads,
    activeThread,
    entries,
    loading,
    error,
    asking,
    ask,
    createThread,
    selectThread,
    deleteThread,
    clearThread,
  } = useAsk(projectId)
  const [value, setValue] = useState('')
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 560))
  const [railOpen, setRailOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      const stored = window.localStorage.getItem(RAIL_KEY)
      if (stored === '0') return false
      if (stored === '1') return true
    } catch {
      /* ignore */
    }
    return window.innerWidth >= 560
  })
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onResize() {
      setWide(window.innerWidth >= 560)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function setRail(next: boolean) {
    setRailOpen(next)
    try {
      window.localStorage.setItem(RAIL_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  function toggleRail() {
    setRail(!railOpen)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, asking])

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setValue('')
    void ask(trimmed)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(event as unknown as FormEvent)
    }
  }

  const rail = (
    <aside className="flex h-full w-[176px] shrink-0 flex-col border-r border-line bg-paper-2/80">
      <div className="flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          onClick={() => {
            void createThread()
            if (!wide) toggleRail()
          }}
          className="min-w-0 flex-1 rounded-lg bg-forest px-2.5 py-2 text-left text-xs font-medium text-cream hover:bg-forest-2"
        >
          + Nueva consulta
        </button>
        <button
          type="button"
          title="Minimizar conversaciones"
          aria-label="Minimizar conversaciones"
          onClick={toggleRail}
          className="rounded-lg p-1.5 text-ink-soft hover:bg-cream hover:text-ink"
        >
          <CollapseIcon />
        </button>
      </div>
      <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 scrollbar-thin">
        {threads.length === 0 ? (
          <li className="px-2 py-2 text-xs text-ink-soft">Aún no hay conversaciones.</li>
        ) : (
          threads.map((thread) => (
            <li key={thread.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => {
                  selectThread(thread.id)
                  if (!wide) toggleRail()
                }}
                className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-xs ${
                  thread.id === activeThread?.id ? 'bg-cream text-ink' : 'text-ink-soft hover:bg-cream/70'
                }`}
              >
                {thread.title}
              </button>
              <button
                type="button"
                title="Eliminar conversación"
                aria-label={`Eliminar ${thread.title}`}
                onClick={() => void deleteThread(thread.id)}
                className="rounded-md p-1 text-ink-soft opacity-0 hover:bg-cream hover:text-danger group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  )

  return (
    <div className="relative flex h-full min-h-0">
      {wide && railOpen ? rail : null}
      {!wide && railOpen ? (
        <>
          <button
            type="button"
            aria-label="Cerrar lista de conversaciones"
            className="absolute inset-0 z-10 bg-ink/15"
            onClick={() => setRail(false)}
          />
          <div className="absolute inset-y-0 left-0 z-20 shadow-lg">{rail}</div>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          {!railOpen || !wide ? (
            <button
              type="button"
              title="Maximizar conversaciones"
              aria-label="Maximizar conversaciones"
              onClick={toggleRail}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-paper hover:text-ink"
            >
              <ExpandIcon />
            </button>
          ) : null}
          <p className="min-w-0 flex-1 truncate text-xs text-ink">
            {activeThread?.title ?? 'Nueva consulta'}
          </p>
          <button
            type="button"
            title="Limpiar conversación"
            aria-label="Limpiar conversación"
            disabled={entries.length === 0}
            onClick={() => void clearThread()}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-30"
          >
            <ClearIcon />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5 scrollbar-thin">
          {loading ? (
            <p className="text-sm text-ink-soft">Cargando…</p>
          ) : entries.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-soft">
                Pregúntame sobre renta o compraventa en Yucatán. Te contesto con el Código Civil;
                esto no cambia ningún borrador.
              </p>
              <div className="space-y-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    disabled={asking}
                    onClick={() => void ask(example.question)}
                    className="block w-full rounded-xl border border-line px-3 py-2.5 text-left hover:border-forest/40 disabled:opacity-50"
                  >
                    <span className="block text-sm font-medium text-ink">{example.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                      {example.question}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {entries.map((entry) => (
                <div key={entry.id} className="space-y-1.5">
                  <div className="flex justify-end">
                    <div className="max-w-[90%] rounded-2xl rounded-br-md bg-forest px-3.5 py-2 text-sm text-cream">
                      {entry.question}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-line bg-cream px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                      <p className="whitespace-pre-wrap">{entry.answer}</p>
                      <Citations citations={entry.citations} />
                    </div>
                  </div>
                  <p className="text-right text-[11px] text-ink-soft">{formatClock(entry.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
          {asking ? <p className="mt-3 text-sm text-ink-soft">Buscando en el Código Civil…</p> : null}
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="shrink-0 border-t border-line p-2.5">
          <div className="flex items-end gap-2 rounded-xl border border-line bg-paper p-1.5">
            <AutoGrowTextarea
              value={value}
              maxHeight={140}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Pregunta algo sobre la ley…"
              className="min-h-9 flex-1 bg-transparent px-2.5 py-1.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-soft/70"
            />
            <button
              type="submit"
              disabled={asking || !value.trim()}
              className="mb-0.5 min-h-9 rounded-lg bg-forest px-3.5 py-1.5 text-sm font-semibold text-cream disabled:opacity-40"
            >
              Preguntar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M3 3.5h4.5M3 3.5v4.5M3 3.5l4 4M13 12.5H8.5M13 12.5V8M13 12.5l-4-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M7 3.5H3.5V7M3.5 3.5l4 4M9 12.5h3.5V9M12.5 12.5l-4-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M3 12.5h7.5M4 10l7-7 2 2-7 7H4v-2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M3.5 5h9M6 5V3.8h4V5M5 5l.5 8h5l.5-8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
