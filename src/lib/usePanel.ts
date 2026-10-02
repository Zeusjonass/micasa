import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type PanelOptions = {
  defaultWidth: number
  minWidth: number
  maxWidth: number
  defaultCollapsed?: boolean
}

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* almacenamiento no disponible (modo privado, etc.): no es crítico */
  }
}

/**
 * Estado de un panel lateral redimensionable y colapsable (sidebar de
 * proyectos, panel de datos+chat del documento). El ancho y el colapso se
 * recuerdan por `storageKey` para que la preferencia del usuario persista
 * entre sesiones.
 */
export function usePanel(
  storageKey: string,
  { defaultWidth, minWidth, maxWidth, defaultCollapsed = false }: PanelOptions,
) {
  const [width, setWidthState] = useState(() => {
    const stored = readNumber(`${storageKey}:width`)
    if (stored && stored >= minWidth && stored <= maxWidth) return stored
    return defaultWidth
  })
  const [collapsed, setCollapsedState] = useState(() => readBool(`${storageKey}:collapsed`, defaultCollapsed))
  const dragging = useRef(false)

  const setWidth = useCallback(
    (next: number) => {
      const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(next)))
      setWidthState(clamped)
      writeStorage(`${storageKey}:width`, String(clamped))
    },
    [storageKey, minWidth, maxWidth],
  )

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next)
      writeStorage(`${storageKey}:collapsed`, next ? '1' : '0')
    },
    [storageKey],
  )

  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed])

  const startResize = useCallback(
    (event: ReactPointerEvent, side: 'left' | 'right') => {
      event.preventDefault()
      dragging.current = true
      const startX = event.clientX
      const startWidth = width

      function onMove(moveEvent: PointerEvent) {
        if (!dragging.current) return
        const delta = moveEvent.clientX - startX
        // Handle a la izquierda de un panel derecho: arrastrar a la izquierda ensancha.
        // Handle a la derecha de un panel izquierdo: arrastrar a la derecha ensancha.
        setWidth(side === 'left' ? startWidth - delta : startWidth + delta)
      }
      function onUp() {
        dragging.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [width, setWidth],
  )

  return { width, setWidth, collapsed, setCollapsed, toggleCollapsed, startResize }
}
