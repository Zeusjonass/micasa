import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { formatClock } from '../../lib/ids'
import type { DocumentDetail, Turn } from '../../lib/types'
import { AutoGrowTextarea } from '../shared/AutoGrowTextarea'
import { QuestionsBlock } from '../shared/QuestionsBlock'

const EXAMPLE_PROMPTS = [
  {
    id: 'renta-base',
    label: 'Renta lista para firmar',
    hint: 'Datos completos de un depto en el Centro.',
    prompt:
      'Quiero un contrato de renta. Arrendador: Luis Herrera Poot. Arrendataria: Mariana Cetina López. Inmueble: Calle 60 #489 por 57 y 59, Centro, Mérida, Yucatán. Renta: 12,000 pesos mensuales. Plazo: 12 meses. Depósito: 1 mes de renta. Día de pago: el día 5 de cada mes.',
  },
  {
    id: 'renta-extras',
    label: 'Renta con mascota y reparaciones',
    hint: 'Caso más real: pacto extra y quién paga qué.',
    prompt:
      'Quiero un contrato de renta de una casa en Cholul. Arrendador: Roberto Aguilar Cámara. Arrendatario: Diego Pech May. Dirección: Calle 20 #118 por 15 y 17, Cholul, Mérida, Yucatán. Renta: 9,500 pesos. Plazo: 18 meses. Depósito: 1 mes de renta. El inquilino puede tener un perro pequeño y se hace cargo de cualquier daño que cause. Quiero que quede claro que las reparaciones mayores las pago yo como dueño y las menores el inquilino.',
  },
  {
    id: 'venta-base',
    label: 'Compraventa lista para firmar',
    hint: 'Casa en Cholul, precio y forma de pago.',
    prompt:
      'Quiero un contrato de compraventa de casa habitación, no una promesa. Vendedor: Roberto Aguilar Cámara. Compradora: Erika Villa González. Inmueble: Calle 20 #118 por 15 y 17, Cholul, Mérida, Yucatán. Precio: 1,500,000 pesos. Forma de pago: transferencia electrónica a la firma del contrato. Día de pago: el día de la firma.',
  },
] as const

type ChatPanelProps = {
  document: DocumentDetail
  streamingText: string
  sending: boolean
  reviewPending: boolean
  saving: boolean
  onSend: (text: string) => void
  onAcceptAll: () => void
  onRejectAll: () => void
}

export function ChatPanel({
  document,
  streamingText,
  sending,
  reviewPending,
  saving,
  onSend,
  onAcceptAll,
  onRejectAll,
}: ChatPanelProps) {
  const [value, setValue] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastAssistantIndex = document.turns.reduce(
    (found, turn, index) => (turn.role === 'assistant' ? index : found),
    -1,
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [document.turns, streamingText])

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || sending) return
    onSend(trimmed)
    setValue('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(event as unknown as FormEvent)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <p className="text-sm font-medium text-ink">Pide cambios al documento</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          Ej. «cambia el depósito a 2 meses», «agrega cláusula de no mascotas», «olvidé el plazo,
          son 12 meses».
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
        {document.turns.length === 0 && !streamingText ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              {document.contractType
                ? 'Dime los datos que falten, o usa un ejemplo para armar el borrador de una vez.'
                : 'Elige un ejemplo o escribe el tipo de contrato y los datos.'}
            </p>
            <div className="space-y-2">
              {EXAMPLE_PROMPTS.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  onClick={() => onSend(example.prompt)}
                  className="block w-full rounded-xl border border-line bg-paper px-3 py-3 text-left hover:border-forest/40"
                >
                  <span className="block text-sm font-medium text-ink">{example.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{example.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {document.turns.map((turn, index) => (
              <TurnBubble
                key={turn.id}
                turn={turn}
                onPick={onSend}
                actions={
                  reviewPending &&
                  !sending &&
                  turn.role === 'assistant' &&
                  index === lastAssistantIndex ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={onAcceptAll}
                        className="rounded-lg bg-forest px-3 py-1.5 text-xs font-medium text-cream disabled:opacity-40"
                      >
                        Aceptar todos los cambios
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={onRejectAll}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink disabled:opacity-40"
                      >
                        Descartar
                      </button>
                    </div>
                  ) : null
                }
              />
            ))}
            {sending ? (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-line bg-cream px-4 py-3 text-[15px] leading-relaxed text-ink">
                  {streamingText || <span className="text-ink-soft">Escribiendo…</span>}
                </div>
              </div>
            ) : null}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="safe-bottom shrink-0 border-t border-line p-3">
        <div className="paper-shadow flex items-end gap-2 rounded-2xl border border-line bg-cream p-2">
          <AutoGrowTextarea
            value={value}
            disabled={sending}
            maxHeight={240}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Escribe el cambio o los datos que faltan…"
            className="min-h-11 flex-1 bg-transparent px-3 py-2 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-soft/70"
          />
          <button
            type="submit"
            disabled={sending || !value.trim()}
            className="mb-0.5 min-h-10 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-cream disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  )
}

function TurnBubble({
  turn,
  onPick,
  actions,
}: {
  turn: Turn
  onPick: (text: string) => void
  actions?: ReactNode
}) {
  const isUser = turn.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[90%]">
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-md bg-forest px-4 py-2.5 text-[15px] leading-relaxed text-cream'
              : 'rounded-2xl rounded-bl-md border border-line bg-cream px-4 py-3 text-[15px] leading-relaxed text-ink'
          }
        >
          <p className="whitespace-pre-wrap">{turn.content}</p>
          {!isUser && turn.questions.length > 0 ? (
            <QuestionsBlock questions={turn.questions} onPick={onPick} />
          ) : null}
          {!isUser && turn.documentVersion ? (
            <p className="mt-2 text-xs font-medium text-moss">
              ↳ Documento actualizado a v{turn.documentVersion}
            </p>
          ) : null}
          {actions}
        </div>
        <p className={`mt-1 text-[11px] text-ink-soft ${isUser ? 'text-right' : ''}`}>
          {formatClock(turn.createdAt)}
        </p>
      </div>
    </div>
  )
}
