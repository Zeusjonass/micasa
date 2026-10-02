import type { AgentQuestion } from '../../lib/types'

export function QuestionsBlock({
  questions,
  onPick,
}: {
  questions: AgentQuestion[]
  onPick?: (text: string) => void
}) {
  const confirm = questions.every((question) => question.id.startsWith('confirm'))
  const chooseType = questions.every((question) => question.id.startsWith('tipo'))
  const heading = confirm ? 'Confirmación' : chooseType ? 'Elige una opción' : 'Datos que faltan'
  return (
    <div className="mt-3 rounded-2xl border border-line bg-paper-2/70 p-3">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-gold-2 uppercase">{heading}</p>
      <ul className="mt-2 space-y-1.5">
        {questions.map((question) => (
          <li key={question.id} className="text-sm text-ink">
            <span className="mr-2 text-gold-2">▸</span>
            {question.prompt}
          </li>
        ))}
      </ul>
      {onPick ? (
        <p className="mt-2 text-xs text-ink-soft">
          Responde en el cuadro de abajo. Si ya los tienes, mándalos juntos.
        </p>
      ) : null}
    </div>
  )
}
