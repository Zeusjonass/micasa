import { formatRelative } from '../../lib/ids'
import type { DocumentSummary } from '../../lib/types'

const KIND_LABEL: Record<DocumentSummary['kind'], string> = {
  contract: 'Contrato',
  pdf: 'PDF',
  note: 'Nota',
}

type DocumentCardProps = {
  document: DocumentSummary
  onOpen: (id: string) => void
}

export function DocumentCard({ document, onOpen }: DocumentCardProps) {
  const statusLabel = document.status === 'ready' ? `Versión ${document.currentVersion}` : 'En progreso'
  const typeLabel =
    document.contractType === 'renta' ? 'Renta' : document.contractType === 'venta' ? 'Compraventa' : null

  return (
    <button
      type="button"
      onClick={() => onOpen(document.id)}
      className="flex flex-col rounded-2xl border border-line bg-cream p-4 text-left transition hover:border-forest/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-soft">
          {KIND_LABEL[document.kind]}
          {typeLabel ? ` · ${typeLabel}` : ''}
        </span>
        <span className="shrink-0 text-[11px] text-ink-soft">{formatRelative(document.updatedAt)}</span>
      </div>
      <p className="mt-3 text-base font-medium text-ink">{document.title}</p>
      <p className="mt-1 text-sm text-ink-soft">{statusLabel}</p>
    </button>
  )
}
