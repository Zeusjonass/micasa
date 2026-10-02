import { useDocuments } from '../../lib/api/hooks'
import { DocumentGrid } from './DocumentGrid'
import { FloatingAssistant } from './FloatingAssistant'

type ProjectViewProps = {
  projectId: string
  onOpenDocument: (docId: string) => void
}

export function ProjectView({ projectId, onOpenDocument }: ProjectViewProps) {
  const { documents, loading, error, create } = useDocuments(projectId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <DocumentGrid documents={documents} loading={loading} error={error} onCreate={create} onOpen={onOpenDocument} />
      </div>
      <FloatingAssistant projectId={projectId} />
    </div>
  )
}
