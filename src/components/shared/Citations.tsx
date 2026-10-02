import type { AgentCitation } from '../../lib/types'

export function Citations({ citations }: { citations: AgentCitation[] }) {
  if (citations.length === 0) return null

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-moss">Fuentes · {citations.length}</p>
      <ul className="mt-2 space-y-1 rounded-xl border border-line bg-cream px-3 py-2 text-xs text-ink-soft">
        {citations.map((citation) => (
          <li key={`${citation.source}-${citation.article ?? ''}-${citation.score ?? ''}`}>
            {citation.source}
            {citation.article ? ` · art. ${citation.article}` : ''}
            {citation.score != null ? ` · score ${citation.score.toFixed(3)}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
