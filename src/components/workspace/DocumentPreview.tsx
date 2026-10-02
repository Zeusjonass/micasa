import { useEffect, useMemo, useRef, useState } from 'react'
import { contractHeading } from '../../lib/contracts/heading'
import {
  joinPartyNames,
  pluralPartyLabel,
  resolveFooter,
  slotsFromFooter,
  splitEmphasis,
  splitPartyNames,
  stripEmphasis,
} from '../../lib/contracts/emphasis'
import { buildContractDocx, fileBase } from '../../lib/docs/buildContractDocx'
import { buildContractPdf } from '../../lib/pdf/buildContractPdf'
import { pdfBlob, triggerDownload } from '../../lib/pdf/blob'
import {
  alignClauses,
  applyDecisions,
  diffWords,
  pendingHunks,
  type ClauseHunk,
  type HunkDecision,
} from '../../lib/diff'
import {
  type Clause,
  type DocumentDetail,
  type DocumentFooter,
  type DocumentReview,
} from '../../lib/types'

type DocumentPreviewProps = {
  document: DocumentDetail
  review: DocumentReview | null
  saving: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onApply: (
    clauses: Clause[],
    extra?: { footer?: DocumentDetail['footer']; slots?: Record<string, string> },
  ) => Promise<void>
}

export function DocumentPreview({
  document,
  review,
  saving,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onApply,
}: DocumentPreviewProps) {
  const [busy, setBusy] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, HunkDecision>>({})

  useEffect(() => {
    setDecisions({})
  }, [review])
  const contractType = document.contractType
  const hunks = useMemo(
    () => (review ? alignClauses(review.base, review.proposed) : []),
    [review],
  )
  const pending = useMemo(() => pendingHunks(hunks), [hunks])
  const reviewing = pending.length > 0
  const displayClauses = reviewing ? review?.proposed ?? document.clauses : document.clauses
  const hasDocument = Boolean(contractType) && (displayClauses.length > 0 || reviewing)
  const footer = contractType ? resolveFooter(contractType, document.slots, document.footer) : null

  async function downloadPdf() {
    if (!contractType || displayClauses.length === 0) return
    setBusy(true)
    try {
      const pdf = await buildContractPdf({
        type: contractType,
        title: document.title,
        slots: document.slots,
        clauses: displayClauses,
        footer,
        version: document.currentVersion,
      })
      triggerDownload(pdfBlob(pdf.bytes), `${fileBase(document.title, document.currentVersion)}.pdf`)
    } finally {
      setBusy(false)
    }
  }

  async function downloadWord() {
    if (!contractType || displayClauses.length === 0) return
    setBusy(true)
    try {
      const blob = await buildContractDocx({
        type: contractType,
        title: document.title,
        slots: document.slots,
        clauses: displayClauses,
        footer,
        version: document.currentVersion,
      })
      triggerDownload(blob, `${fileBase(document.title, document.currentVersion)}.docx`)
    } finally {
      setBusy(false)
    }
  }

  async function decideAll(decision: HunkDecision) {
    if (!review) return
    const clauses = applyDecisions(hunks, decisions, decision)
    setDecisions({})
    await onApply(clauses)
  }

  async function decideOne(hunk: ClauseHunk, decision: HunkDecision) {
    const next = { ...decisions, [hunk.id]: decision }
    const remaining = pending.filter((item) => !next[item.id])
    if (remaining.length === 0) {
      setDecisions({})
      await onApply(applyDecisions(hunks, next))
      return
    }
    setDecisions(next)
  }

  async function saveClause(clauseId: string, patch: { title?: string; body?: string }) {
    const next = document.clauses.map((clause) =>
      clause.id === clauseId ? { ...clause, ...patch } : clause,
    )
    await onApply(next)
  }

  async function saveFooter(next: NonNullable<typeof footer>) {
    if (!contractType) return
    await onApply(document.clauses, {
      footer: next,
      slots: slotsFromFooter(contractType, next),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <p className="text-sm text-ink-soft">
          {reviewing ? 'Revisa los cambios del agente' : 'Clic en un título o párrafo para editarlo'}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            title="Deshacer"
            aria-label="Deshacer"
            disabled={saving || reviewing || !canUndo}
            onClick={onUndo}
            className="rounded-lg border border-line p-1.5 text-ink disabled:opacity-40"
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            title="Rehacer"
            aria-label="Rehacer"
            disabled={saving || reviewing || !canRedo}
            onClick={onRedo}
            className="rounded-lg border border-line p-1.5 text-ink disabled:opacity-40"
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            disabled={busy || !hasDocument || displayClauses.length === 0}
            onClick={() => void downloadWord()}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-40"
          >
            Word
          </button>
          <button
            type="button"
            disabled={busy || !hasDocument || displayClauses.length === 0}
            onClick={() => void downloadPdf()}
            className="rounded-lg bg-forest px-3 py-1.5 text-sm font-medium text-cream disabled:opacity-40"
          >
            PDF
          </button>
        </div>
      </div>

      {reviewing ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-3 py-2.5 sm:px-4">
          <p className="min-w-0 flex-1 text-sm text-ink">
            {pending.length === 1
              ? '1 cambio pendiente'
              : `${pending.length} cambios pendientes`}
            {saving ? ' · Guardando…' : ''}
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void decideAll('reject')}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-40"
          >
            Descartar todo
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void decideAll('accept')}
            className="rounded-lg bg-forest px-3 py-1.5 text-sm font-medium text-cream disabled:opacity-40"
          >
            Aceptar todo
          </button>
        </div>
      ) : null}

      {!hasDocument || !contractType ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className="text-base font-medium text-ink">Aún no hay documento</p>
            <p className="mt-2 max-w-sm text-sm text-ink-soft">
              Platica con el agente para elegir el tipo de contrato y los datos. En cuanto estén
              completos, el borrador aparece aquí mismo y se va actualizando en vivo.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-paper-2/80 px-3 py-6 scrollbar-thin">
          <article className="paper-shadow mx-auto min-h-0 max-w-[760px] bg-white px-5 py-8 text-[15px] leading-relaxed text-ink sm:min-h-[900px] sm:px-10 sm:py-12">
            <h1 className="mb-8 text-center font-serif text-2xl uppercase leading-snug">
              <InlinePlain
                value={contractHeading(contractType, footer?.heading)}
                disabled={reviewing}
                className="font-serif text-2xl uppercase leading-snug"
                onSave={(heading) => void saveFooter({ ...footer!, heading })}
              />
            </h1>
            {(reviewing ? hunks : document.clauses.map((clause) => ({ type: 'same' as const, id: clause.id, clause }))).map(
              (hunk) => (
                <ClauseBlock
                  key={hunk.id}
                  hunk={hunk}
                  decision={decisions[hunk.id]}
                  reviewing={reviewing}
                  saving={saving}
                  onDecide={decideOne}
                  onSave={saveClause}
                />
              ),
            )}
            {footer ? (
              <ClosingBlock
                footer={footer}
                disabled={reviewing}
                onSave={(next) => void saveFooter(next)}
              />
            ) : null}
          </article>
        </div>
      )}
    </div>
  )
}

function ClauseBlock({
  hunk,
  decision,
  reviewing,
  saving,
  onDecide,
  onSave,
}: {
  hunk: ClauseHunk
  decision?: HunkDecision
  reviewing: boolean
  saving: boolean
  onDecide: (hunk: ClauseHunk, decision: HunkDecision) => void
  onSave: (id: string, patch: { title?: string; body?: string }) => Promise<void>
}) {
  if (hunk.type === 'remove' && decision === 'accept') return null
  if (hunk.type === 'add' && decision === 'reject') return null

  const clause =
    hunk.type === 'edit'
      ? decision === 'reject'
        ? hunk.before
        : hunk.after
      : hunk.clause
  const resolved =
    hunk.type === 'same'
      ? 'same'
      : decision === 'accept'
        ? 'accepted'
        : decision === 'reject'
          ? 'rejected'
          : 'pending'
  const canEdit = !reviewing && hunk.type === 'same'

  return (
    <section
      className={`mb-6 rounded-xl ${
        resolved === 'pending' && hunk.type !== 'same' ? 'bg-paper/70 px-3 py-3 sm:-mx-3' : ''
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <InlinePlain
          value={clause.title}
          disabled={!canEdit}
          className="min-w-0 flex-1 text-xs font-semibold tracking-[0.08em] text-ink uppercase"
          onSave={(title) => void onSave(clause.id, { title })}
        />
        {resolved === 'pending' && hunk.type !== 'same' ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => onDecide(hunk, 'reject')}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink hover:bg-cream disabled:opacity-40"
            >
              Descartar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onDecide(hunk, 'accept')}
              className="rounded-md bg-forest px-2 py-1 text-[11px] font-medium text-cream disabled:opacity-40"
            >
              Aceptar
            </button>
          </div>
        ) : null}
      </div>
      {hunk.type === 'edit' && !decision ? (
        <p className="text-justify">
          {diffWords(stripEmphasis(hunk.before.body), stripEmphasis(hunk.after.body)).map((part, index) => (
            <span
              key={`${hunk.id}-${index}`}
              className={
                part.type === 'del' ? 'diff-del' : part.type === 'ins' ? 'diff-ins' : undefined
              }
            >
              {part.text}
            </span>
          ))}
        </p>
      ) : hunk.type === 'add' && !decision ? (
        <p className="diff-ins text-justify">{stripEmphasis(hunk.clause.body)}</p>
      ) : hunk.type === 'remove' && !decision ? (
        <p className="diff-del text-justify">{stripEmphasis(hunk.clause.body)}</p>
      ) : canEdit ? (
        <InlinePlain
          value={stripEmphasis(clause.body)}
          multiline
          className="text-justify text-[15px] leading-relaxed"
          onSave={(body) => void onSave(clause.id, { body })}
        />
      ) : (
        <p className="text-justify">
          {splitEmphasis(clause.body).map((run, index) =>
            run.emphasize ? <strong key={index}>{run.text}</strong> : <span key={index}>{run.text}</span>,
          )}
        </p>
      )}
    </section>
  )
}

function InlinePlain({
  value,
  className,
  disabled,
  multiline,
  onSave,
}: {
  value: string
  className?: string
  disabled?: boolean
  multiline?: boolean
  onSave: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing || !ref.current) return
    ref.current.textContent = value
    ref.current.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(ref.current)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [editing, value])

  function commit() {
    const next = (ref.current?.innerText ?? '').replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim()
    setEditing(false)
    if (!next || next === value.trim()) return
    onSave(next)
  }

  if (disabled) {
    return <div className={className}>{value}</div>
  }

  if (!editing) {
    return (
      <div
        className={`${className ?? ''} cursor-text ${multiline ? '' : 'decoration-ink-soft/35 underline-offset-4 hover:underline'}`}
        title="Clic para editar"
        onClick={() => setEditing(true)}
      >
        {value}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline={multiline || undefined}
      contentEditable
      suppressContentEditableWarning
      className={`${className ?? ''} caret-forest outline-none`}
      onBlur={commit}
      onPaste={(event) => {
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setEditing(false)
        }
        if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

function ClosingBlock({
  footer,
  disabled,
  onSave,
}: {
  footer: DocumentFooter
  disabled: boolean
  onSave: (footer: DocumentFooter) => void
}) {
  const leftSigners = footer.leftSigners ?? splitPartyNames(footer.leftName)
  const rightSigners = footer.rightSigners ?? splitPartyNames(footer.rightName)

  function saveSigners(side: 'left' | 'right', names: string[]) {
    const clean = names.map((name) => (name.trim() === '________________' ? '' : name.trim()))
    if (side === 'left') {
      onSave({
        ...footer,
        leftSigners: clean,
        leftName: joinPartyNames(clean),
      })
      return
    }
    onSave({
      ...footer,
      rightSigners: clean,
      rightName: joinPartyNames(clean),
    })
  }

  function editSigner(side: 'left' | 'right', index: number, value: string) {
    const current = side === 'left' ? [...leftSigners] : [...rightSigners]
    const parts = splitPartyNames(value)
    if (parts.length > 1) {
      current.splice(index, 1, ...parts)
    } else if (!value.trim() || value.trim() === '________________') {
      current.splice(index, 1)
    } else {
      current[index] = value.trim()
    }
    saveSigners(side, current)
  }

  return (
    <div className="mt-10">
      <InlinePlain
        value={footer.disclaimer}
        disabled={disabled}
        multiline
        className="whitespace-pre-wrap text-[11px] leading-snug text-ink-soft"
        onSave={(disclaimer) => onSave({ ...footer, disclaimer })}
      />
      <div className="mt-12 text-left text-[15px] leading-relaxed">
        <InlinePlain
          value={footer.closing}
          disabled={disabled}
          multiline
          className="whitespace-pre-wrap text-left text-[15px] leading-relaxed"
          onSave={(closing) => onSave({ ...footer, closing })}
        />
      </div>
      <div className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2 sm:gap-8">
        {footer.leftHidden ? (
          <RestoreColumn
            label={footer.leftLabel || 'Vendedores'}
            disabled={disabled}
            onRestore={() =>
              onSave({
                ...footer,
                leftHidden: false,
                leftSigners: leftSigners.length ? leftSigners : [''],
              })
            }
          />
        ) : (
          <SignerColumn
            heading={pluralPartyLabel(footer.leftLabel, leftSigners.length)}
            headingFallback={footer.leftLabel}
            names={leftSigners}
            disabled={disabled}
            onHeading={(leftLabel) => onSave({ ...footer, leftLabel })}
            onEdit={(index, value) => editSigner('left', index, value)}
            onRemove={(index) => saveSigners('left', leftSigners.filter((_, i) => i !== index))}
            onAdd={() => saveSigners('left', [...leftSigners, ''])}
            onHide={() => onSave({ ...footer, leftHidden: true })}
          />
        )}
        {footer.rightHidden ? (
          <RestoreColumn
            label={footer.rightLabel || 'Compradores'}
            disabled={disabled}
            onRestore={() =>
              onSave({
                ...footer,
                rightHidden: false,
                rightSigners: rightSigners.length ? rightSigners : [''],
              })
            }
          />
        ) : (
          <SignerColumn
            heading={pluralPartyLabel(footer.rightLabel, rightSigners.length)}
            headingFallback={footer.rightLabel}
            names={rightSigners}
            disabled={disabled}
            onHeading={(rightLabel) => onSave({ ...footer, rightLabel })}
            onEdit={(index, value) => editSigner('right', index, value)}
            onRemove={(index) => saveSigners('right', rightSigners.filter((_, i) => i !== index))}
            onAdd={() => saveSigners('right', [...rightSigners, ''])}
            onHide={() => onSave({ ...footer, rightHidden: true })}
          />
        )}
      </div>
    </div>
  )
}

function SignerColumn({
  heading,
  headingFallback,
  names,
  disabled,
  onHeading,
  onEdit,
  onRemove,
  onAdd,
  onHide,
}: {
  heading: string
  headingFallback: string
  names: string[]
  disabled: boolean
  onHeading: (value: string) => void
  onEdit: (index: number, value: string) => void
  onRemove: (index: number) => void
  onAdd: () => void
  onHide: () => void
}) {
  return (
    <div className="group/col relative min-w-0 rounded-xl px-2 py-2 text-center text-xs transition-colors hover:bg-paper/70">
      {disabled ? null : (
        <button
          type="button"
          title="Quitar esta parte"
          aria-label="Quitar esta parte"
          onClick={onHide}
          className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[13px] leading-none text-ink-soft opacity-0 hover:bg-white hover:text-danger group-hover/col:opacity-100"
        >
          ×
        </button>
      )}
      <InlinePlain
        value={heading || headingFallback}
        disabled={disabled}
        className="font-semibold tracking-wide uppercase"
        onSave={onHeading}
      />
      <div className="mt-2 grid grid-cols-1 gap-6">
        {names.map((name, index) => (
          <div
            key={`signer-${index}`}
            className="group/line relative rounded-lg px-1 pt-7 pb-1 transition-colors hover:bg-white/80"
          >
            {disabled ? null : (
              <button
                type="button"
                title="Quitar esta firma"
                aria-label={`Quitar firma de ${name || 'esta línea'}`}
                onClick={() => onRemove(index)}
                className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full text-[13px] leading-none text-ink-soft opacity-0 hover:bg-paper hover:text-danger group-hover/line:opacity-100"
              >
                ×
              </button>
            )}
            <div className="border-t border-ink pt-2 font-bold">
              <InlinePlain
                value={name || '________________'}
                disabled={disabled}
                className="font-bold"
                onSave={(value) => onEdit(index, value)}
              />
            </div>
          </div>
        ))}
      </div>
      {disabled ? null : (
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 text-[11px] text-ink-soft hover:text-ink"
        >
          + Firmante
        </button>
      )}
    </div>
  )
}

function RestoreColumn({
  label,
  disabled,
  onRestore,
}: {
  label: string
  disabled: boolean
  onRestore: () => void
}) {
  if (disabled) return <div />
  return (
    <button
      type="button"
      onClick={onRestore}
      className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-line px-3 text-center text-xs text-ink-soft hover:border-forest/40 hover:text-ink"
    >
      Mostrar {label.toLocaleLowerCase('es-MX')}
    </button>
  )
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path
        d="M3.5 7.5h6.5a3 3 0 1 1 0 6H8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M3.5 7.5 6 5M3.5 7.5 6 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12.5 7.5H6a3 3 0 1 0 0 6h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M12.5 7.5 10 5M12.5 7.5 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
