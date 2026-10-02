import type { PointerEvent as ReactPointerEvent } from 'react'

type ResizeHandleProps = {
  onPointerDown: (event: ReactPointerEvent) => void
  className?: string
}

/** Barra delgada arrastrable para redimensionar un panel lateral (solo escritorio). */
export function ResizeHandle({ onPointerDown, className }: ResizeHandleProps) {
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      className={`group absolute inset-y-0 z-20 w-3 cursor-col-resize touch-none select-none ${className ?? ''}`}
    >
      <div className="mx-auto h-full w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-forest/50" />
    </div>
  )
}
