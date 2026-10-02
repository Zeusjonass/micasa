import { useState } from 'react'
import type { ContractType, DocumentDetail } from '../../lib/types'

const LABELS: Record<string, string> = {
  arrendador: 'Arrendador',
  arrendatario: 'Arrendatario',
  vendedor: 'Vendedor',
  comprador: 'Comprador',
  direccion: 'Dirección',
  rentaMensual: 'Renta mensual',
  plazo: 'Plazo',
  deposito: 'Depósito',
  diaPago: 'Día de pago',
  precio: 'Precio',
  formaPago: 'Forma de pago',
}

const ORDER_BY_TYPE: Record<ContractType, string[]> = {
  renta: ['arrendador', 'arrendatario', 'direccion', 'rentaMensual', 'plazo', 'deposito', 'diaPago'],
  venta: ['vendedor', 'comprador', 'direccion', 'precio', 'formaPago'],
}

type SlotsPanelProps = {
  document: DocumentDetail
  disabled: boolean
  onEditSlot: (label: string, value: string) => void
}

export function SlotsPanel({ document, disabled, onEditSlot }: SlotsPanelProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')

  if (!document.contractType) return null

  const order = ORDER_BY_TYPE[document.contractType]
  const keys = [...order, ...Object.keys(document.slots).filter((key) => !order.includes(key))]

  function startEdit(key: string) {
    if (disabled) return
    setEditing(key)
    setValue(document.slots[key] ?? '')
  }

  function commit(key: string) {
    const trimmed = value.trim()
    setEditing(null)
    if (!trimmed || trimmed === document.slots[key]) return
    onEditSlot(LABELS[key] ?? key, trimmed)
  }

  return (
    <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-line px-4 py-3 scrollbar-thin">
      <p className="text-xs font-semibold tracking-[0.1em] text-ink-soft uppercase">
        Datos del contrato
      </p>
      {/* Una sola columna: el ancho de este panel es variable (se puede
          arrastrar), así que una grilla a 2 columnas basada en el viewport
          (sm:grid-cols-2) terminaba encimando el valor de una fila con la
          etiqueta de la siguiente cuando el panel quedaba angosto. */}
      <dl className="mt-2 flex flex-col gap-0.5">
        {keys.map((key) => {
          const label = LABELS[key] ?? key
          const current = document.slots[key]
          return (
            <div
              key={key}
              className="flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-paper"
            >
              <dt className="shrink-0 text-xs text-ink-soft">{label}</dt>
              {editing === key ? (
                <input
                  autoFocus
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onBlur={() => commit(key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit(key)
                    if (event.key === 'Escape') setEditing(null)
                  }}
                  className="min-w-0 flex-1 rounded-md border border-line bg-cream px-2 py-1 text-right text-xs text-ink outline-none focus:border-forest/50"
                />
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => startEdit(key)}
                  title="Editar"
                  className="min-w-0 flex-1 truncate text-right text-xs font-medium text-ink hover:underline disabled:no-underline disabled:opacity-60"
                >
                  {current || '— pedir al agente —'}
                </button>
              )}
            </div>
          )
        })}
      </dl>
    </div>
  )
}
