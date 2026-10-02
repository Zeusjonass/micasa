import { useState } from 'react'
import type { DocumentSummary } from '../../lib/types'
import { DocumentCard } from './DocumentCard'
import { NewDocumentMenu } from './NewDocumentMenu'

type DocumentGridProps = {
  documents: DocumentSummary[]
  loading: boolean
  error: string | null
  onCreate: (input: { kind?: 'contract' }) => Promise<DocumentSummary>
  onOpen: (id: string) => void
}

export function DocumentGrid({ documents, loading, error, onCreate, onOpen }: DocumentGridProps) {
  const [creating, setCreating] = useState(false)

  async function createDraft() {
    setCreating(true)
    try {
      const doc = await onCreate({ kind: 'contract' })
      onOpen(doc.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xl font-medium text-ink">Documentos</p>
          <p className="text-sm text-ink-soft">Borradores de contrato de este proyecto.</p>
        </div>
        <NewDocumentMenu onCreateDraft={() => void createDraft()} />
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Cargando…</p>
      ) : error ? (
        <p className="mt-8 text-sm text-danger">{error}</p>
      ) : documents.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-line bg-cream/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-ink">Aún no hay borradores aquí</p>
          <p className="mt-2 text-sm text-ink-soft">
            Crea el primero y arma un contrato de renta o compraventa platicando con el agente.
          </p>
          <button
            type="button"
            disabled={creating}
            onClick={() => void createDraft()}
            className="mt-4 rounded-xl bg-forest px-4 py-2.5 text-sm font-medium text-cream hover:bg-forest-2 disabled:opacity-50"
          >
            Crear primer borrador
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} document={doc} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}
