export function ProjectsEmptyState({ hasProjects }: { hasProjects: boolean }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-2xl font-medium text-ink">
        {hasProjects ? 'Elige un proyecto' : '¿Qué proyecto vamos a armar?'}
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
        Un proyecto agrupa los borradores — y, más adelante, archivos — de un mismo caso: por
        ejemplo, la renta o compraventa de un inmueble en particular. Crea uno desde el panel
        izquierdo para empezar.
      </p>
    </div>
  )
}
