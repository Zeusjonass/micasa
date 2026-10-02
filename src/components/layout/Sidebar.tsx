import { useState, type CSSProperties, type FormEvent } from 'react'
import { formatRelative } from '../../lib/ids'
import { usePanel } from '../../lib/usePanel'
import type { Project } from '../../lib/types'
import { ResizeHandle } from '../shared/ResizeHandle'

type SidebarProps = {
  open: boolean
  onClose: () => void
  onLogout: () => void
  projects: Project[]
  loading: boolean
  error: string | null
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  onCreateProject: (name: string) => void
}

export function Sidebar({
  open,
  onClose,
  onLogout,
  projects,
  loading,
  error,
  activeProjectId,
  onSelectProject,
  onCreateProject,
}: SidebarProps) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const panel = usePanel('micasa:sidebar', { defaultWidth: 280, minWidth: 220, maxWidth: 380 })

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreateProject(trimmed)
    setName('')
    setCreating(false)
  }

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar menú"
        className={`fixed inset-0 z-20 bg-ink/30 lg:hidden ${open ? 'block' : 'hidden'}`}
        onClick={onClose}
      />

      {/* Riel delgado cuando el panel está colapsado en escritorio. */}
      <div
        className={`shrink-0 flex-col items-center border-r border-line bg-cream py-5 ${
          panel.collapsed ? 'hidden lg:flex' : 'hidden'
        }`}
        style={{ width: 52 }}
      >
        <button
          type="button"
          onClick={panel.toggleCollapsed}
          title="Mostrar proyectos"
          aria-label="Mostrar proyectos"
          className="rounded-lg border border-line p-2 text-ink hover:bg-paper"
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      <aside
        style={{ '--sidebar-width': `${panel.width}px` } as CSSProperties}
        className={`fixed inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-line bg-cream transition-transform lg:relative lg:translate-x-0 lg:w-[var(--sidebar-width)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${panel.collapsed ? 'lg:hidden' : ''}`}
      >
        <ResizeHandle onPointerDown={(event) => panel.startResize(event, 'right')} className="-right-1.5 hidden lg:block" />
        <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <p className="text-lg font-medium text-ink">MiCasa</p>
            <p className="text-xs text-ink-soft">Proyectos</p>
          </div>
          <button
            type="button"
            onClick={panel.toggleCollapsed}
            title="Ocultar proyectos"
            aria-label="Ocultar proyectos"
            className="hidden shrink-0 rounded-lg p-1.5 text-ink-soft hover:bg-paper hover:text-ink lg:inline-flex"
          >
            <ChevronIcon direction="left" />
          </button>
        </div>
        <div className="px-4">
          {creating ? (
            <form onSubmit={submit} className="flex flex-col gap-2">
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Depto Calle 60, Ana López"
                className="rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-forest/50"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-forest px-3 py-2 text-sm font-medium text-cream hover:bg-forest-2"
                >
                  Crear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false)
                    setName('')
                  }}
                  className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center justify-center rounded-xl bg-forest px-3 py-2.5 text-sm font-medium text-cream hover:bg-forest-2"
            >
              + Nuevo proyecto
            </button>
          )}
        </div>
        <div className="mt-4 flex-1 overflow-y-auto px-3 scrollbar-thin">
          <p className="px-2 pb-2 text-[11px] font-medium tracking-[0.12em] text-ink-soft uppercase">
            Tus proyectos
          </p>
          {loading ? (
            <p className="px-2 text-sm text-ink-soft">Cargando…</p>
          ) : error ? (
            <p className="px-2 text-sm text-danger">{error}</p>
          ) : projects.length === 0 ? (
            <p className="px-2 text-sm text-ink-soft">Aún no hay proyectos. Crea el primero.</p>
          ) : (
            <ul className="space-y-1">
              {projects.map((project) => {
                const active = project.id === activeProjectId
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left ${
                        active ? 'bg-paper text-ink' : 'text-ink-soft hover:bg-paper'
                      }`}
                    >
                      <span className="block truncate text-sm font-medium text-ink">
                        {project.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-soft">
                        {formatRelative(project.updatedAt)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-line px-4 py-4">
          <p className="text-xs text-ink-soft">admin</p>
          <button type="button" onClick={onLogout} className="mt-1 text-sm text-ink hover:underline">
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  )
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M12.5 4l-6 6 6 6' : 'M7.5 4l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
