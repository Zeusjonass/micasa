import { useState } from 'react'
import type { AgentCitation } from '../../lib/types'

export function Citations({ citations }: { citations: AgentCitation[] }) {
  const [open, setOpen] = useState(false)
  if (citations.length === 0) return null

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-xs font-medium text-moss underline-offset-2 hover:underline"
      >
        {open ? 'Ocultar fuentes' : `Fuentes · ${citations.length}`}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 rounded-xl border border-line bg-cream px-3 py-2 text-xs text-ink-soft">
          {citations.map((citation) => (
            <li key={`${citation.source}-${citation.article ?? ''}`}>
              {citation.source}
              {citation.article ? ` · art. ${citation.article}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
