export type ContractType = 'renta' | 'venta'

export type DocumentKind = 'contract' | 'pdf' | 'note'

export type DocumentStatus = 'collecting' | 'ready'

export type AgentQuestion = {
  id: string
  prompt: string
}

export type AgentCitation = {
  source: string
  article?: string
  score?: number
}

export type Clause = {
  id: string
  title: string
  body: string
  articles: string[]
}

export type AgentMetrics = {
  latencyMs: number
  ttftMs: number
  retrievalMs: number
}

/** Proyecto: contenedor que agrupa documentos (borradores, y a futuro archivos). */
export type Project = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/** Resumen de un documento, suficiente para pintar una card en el ProjectView. */
export type DocumentSummary = {
  id: string
  projectId: string
  kind: DocumentKind
  contractType: ContractType | null
  title: string
  status: DocumentStatus
  currentVersion: number
  createdAt: string
  updatedAt: string
}

/** Un turno de chat acotado a un documento (ya no a una "conversación" global). */
export type Turn = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  questions: AgentQuestion[]
  citations: AgentCitation[]
  documentVersion?: number
  latencyMs?: number
}

/** Detalle completo de un documento: datos relevantes + cláusulas + historial de turnos. */
export type DocumentFooter = {
  disclaimer: string
  closing: string
  heading?: string
  leftLabel: string
  rightLabel: string
  leftName: string
  rightName: string
  /** Firmantes de la izquierda, uno por raya. `[]` = se quitaron todas. */
  leftSigners?: string[]
  /** Firmantes de la derecha, uno por raya. `[]` = se quitaron todas. */
  rightSigners?: string[]
  leftHidden?: boolean
  rightHidden?: boolean
}

export type DocumentDetail = DocumentSummary & {
  slots: Record<string, string>
  pendingQuestions: AgentQuestion[]
  extraClauses: Clause[]
  clauses: Clause[]
  turns: Turn[]
  footer?: DocumentFooter
}

/**
 * Lo que el backend regresa tras un turno de edición. `clauses`/`version` solo
 * vienen presentes cuando ese turno generó una versión nueva del documento; si
 * se omiten, el documento en pantalla no debe tocarse.
 */
export type DocumentPatch = {
  id: string
  contractType: ContractType | null
  title: string
  status: DocumentStatus
  slots: Record<string, string>
  pendingQuestions: AgentQuestion[]
  extraClauses: Clause[]
  currentVersion: number
  footer?: DocumentFooter
  clauses?: Clause[]
  version?: number
}

/** Propuesta del agente pendiente de aceptar o descartar, frente al texto ya aceptado. */
export type DocumentReview = {
  base: Clause[]
  proposed: Clause[]
}

export type AgentTurnResponse = {
  text: string
  questions: AgentQuestion[]
  citations: AgentCitation[]
  metrics: AgentMetrics
  document: DocumentPatch
}

/** Conversación del asistente legal, independiente de los borradores. */
export type AskThread = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

/** Entrada del asistente legal libre (RAG), fuera de cualquier documento. */
export type AskEntry = {
  id: string
  question: string
  answer: string
  citations: AgentCitation[]
  createdAt: string
}

export type AskResult = AskEntry & { metrics: { latencyMs: number; retrievalMs: number } }

export const SESSION_KEY = 'micasa.session'
export const DISCLAIMER =
  'Borrador informativo. No constituye asesoría jurídica ni sustituye la revisión de un abogado o notario. En Yucatán, la compraventa de inmuebles suele requerir escritura pública e inscripción ante el Registro Público de la Propiedad (INSEJUPY).'

export const DEFAULT_CLOSING =
  'En prueba de lo anterior, las partes firman de conformidad al calce, en la ciudad de Mérida, Yucatán.'
