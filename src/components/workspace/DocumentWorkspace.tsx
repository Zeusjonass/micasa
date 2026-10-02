import { useEffect, useState, type CSSProperties } from 'react'
import { useDocument } from '../../lib/api/hooks'
import { usePanel } from '../../lib/usePanel'
import { ResizeHandle } from '../shared/ResizeHandle'
import { ChatPanel } from './ChatPanel'
import { DocumentPreview } from './DocumentPreview'
import { SlotsPanel } from './SlotsPanel'

type DocumentWorkspaceProps = {
  projectId: string
  docId: string
  onBack: () => void
}

export function DocumentWorkspace({ projectId, docId, onBack }: DocumentWorkspaceProps) {
  const {
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
  } = useDocument(projectId, docId)
  const panel = usePanel('micasa:workspace-panel', { defaultWidth: 480, minWidth: 340, maxWidth: 640 })
  const [mobileView, setMobileView] = useState<'document' | 'chat'>('chat')

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('textarea, input, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) void redo()
        else void undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-paper"
        >
          ← Proyecto
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink">
            {document?.title ?? 'Cargando…'}
          </p>
          <p className="text-xs text-ink-soft">
            {document?.contractType === 'venta'
              ? 'Compraventa'
              : document?.contractType === 'renta'
                ? 'Renta'
                : 'Sin tipo aún'}
            {document ? ` · ${document.status === 'ready' ? `v${document.currentVersion}` : 'En progreso'}` : ''}
          </p>
        </div>
        {/* En móvil no hay espacio para ver documento y chat a la vez: se alterna
            entre ambos con este selector, en vez de encimarlos. */}
        <div className="flex shrink-0 rounded-lg border border-line p-0.5 text-xs lg:hidden">
          <button
            type="button"
            onClick={() => setMobileView('document')}
            className={`rounded-md px-2.5 py-1.5 ${mobileView === 'document' ? 'bg-forest text-cream' : 'text-ink'}`}
          >
            Documento
          </button>
          <button
            type="button"
            onClick={() => setMobileView('chat')}
            className={`rounded-md px-2.5 py-1.5 ${mobileView === 'chat' ? 'bg-forest text-cream' : 'text-ink'}`}
          >
            Chat
          </button>
        </div>
        <button
          type="button"
          onClick={panel.toggleCollapsed}
          className="hidden shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-paper lg:inline-flex"
        >
          {panel.collapsed ? 'Mostrar panel' : 'Ocultar panel'}
        </button>
      </header>

      {loading && !document ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-ink-soft">Cargando documento…</p>
        </div>
      ) : error && !document ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-danger">{error}</p>
        </div>
      ) : document ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            className={`min-h-0 flex-1 overflow-hidden ${mobileView === 'chat' ? 'hidden' : 'block'} lg:block`}
          >
            <DocumentPreview
              document={document}
              review={review}
              saving={saving}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => void undo()}
              onRedo={() => void redo()}
              onApply={applyClauses}
            />
          </div>
          <div
            style={{ '--panel-width': `${panel.width}px` } as CSSProperties}
            className={`relative min-h-0 flex-col overflow-hidden border-line ${
              mobileView === 'document' ? 'hidden' : 'flex w-full'
            } lg:flex lg:w-[var(--panel-width)] lg:shrink-0 lg:border-t-0 lg:border-l ${
              panel.collapsed ? 'lg:hidden' : ''
            }`}
          >
            <ResizeHandle onPointerDown={(event) => panel.startResize(event, 'left')} className="-left-1.5 hidden lg:block" />
            <SlotsPanel
              document={document}
              disabled={sending}
              onEditSlot={(label, value) => void sendTurn(`Actualiza ${label} a: ${value}.`)}
            />
            <ChatPanel
              document={document}
              streamingText={streamingText}
              sending={sending}
              reviewPending={Boolean(review)}
              saving={saving}
              onSend={(text) => void sendTurn(text)}
              onAcceptAll={() => void acceptReview()}
              onRejectAll={() => void rejectReview()}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
