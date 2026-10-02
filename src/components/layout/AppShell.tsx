import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useProjects } from '../../lib/api/hooks'
import { ProjectsEmptyState } from '../projects/ProjectsEmptyState'
import { ProjectView } from '../projects/ProjectView'
import { Sidebar } from './Sidebar'

// DocumentWorkspace carga react-pdf/pdf-lib/docx (pesados): se divide en su
// propio chunk para no inflar el bundle inicial del listado de proyectos.
const DocumentWorkspace = lazy(async () => {
  const mod = await import('../workspace/DocumentWorkspace')
  return { default: mod.DocumentWorkspace }
})

export function AppShell() {
  const { logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { projects, loading, error, create } = useProjects()
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  function selectProject(id: string) {
    setActiveProjectId(id)
    setActiveDocId(null)
    setSidebarOpen(false)
  }

  async function createProject(name: string) {
    const project = await create(name)
    selectProject(project.id)
  }

  return (
    <div className="flex h-full min-h-0 bg-paper">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={logout}
        projects={projects}
        loading={loading}
        error={error}
        activeProjectId={activeProjectId}
        onSelectProject={selectProject}
        onCreateProject={(name) => void createProject(name)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink"
          >
            Menú
          </button>
          <span className="font-serif text-lg">MiCasa</span>
        </header>
        {!activeProjectId ? (
          <ProjectsEmptyState hasProjects={projects.length > 0} />
        ) : activeDocId ? (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-ink-soft">Cargando documento…</p>
              </div>
            }
          >
            <DocumentWorkspace
              projectId={activeProjectId}
              docId={activeDocId}
              onBack={() => setActiveDocId(null)}
            />
          </Suspense>
        ) : (
          <ProjectView projectId={activeProjectId} onOpenDocument={setActiveDocId} />
        )}
      </div>
    </div>
  )
}
