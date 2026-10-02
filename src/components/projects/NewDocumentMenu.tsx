import { useState } from 'react'

type NewDocumentMenuProps = {
  onCreateDraft: () => void
}

const COMING_SOON = [
  { id: 'pdf', label: 'Subir PDF', hint: 'Próximamente: adjunta y organiza PDFs del caso.' },
  { id: 'note', label: 'Nota', hint: 'Próximamente: notas libres dentro del proyecto.' },
]

export function NewDocumentMenu({ onCreateDraft }: NewDocumentMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-xl bg-forest px-4 py-2.5 text-sm font-medium text-cream hover:bg-forest-2"
      >
        + Nuevo
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Cerrar menú"
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-cream shadow-xl">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onCreateDraft()
              }}
              className="block w-full px-4 py-3 text-left hover:bg-paper"
            >
              <span className="block text-sm font-medium text-ink">Borrador de contrato</span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                Renta o compraventa, platicando con el agente.
              </span>
            </button>
            {COMING_SOON.map((item) => (
              <div
                key={item.id}
                className="block w-full cursor-not-allowed border-t border-line px-4 py-3 text-left opacity-50"
              >
                <span className="block text-sm font-medium text-ink">{item.label}</span>
                <span className="mt-0.5 block text-xs text-ink-soft">{item.hint}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
