import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AskPanel } from './AskPanel'

const MARGIN = 16
const CIRCLE = 56
const STORAGE_KEY = 'micasa:assistant-pos'

type Position = { x: number; y: number }

function readPosition(): Position | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Position
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed
  } catch {
    /* ignore */
  }
  return null
}

function writePosition(position: Position) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
  } catch {
    /* ignore */
  }
}

function defaultPosition(): Position {
  return {
    x: Math.max(MARGIN, window.innerWidth - CIRCLE - MARGIN),
    y: Math.max(MARGIN, window.innerHeight - CIRCLE - MARGIN),
  }
}

export function FloatingAssistant({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position>(() => readPosition() ?? defaultPosition())
  const [hint, setHint] = useState(() => !readPosition())
  const positionRef = useRef(position)
  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  const clampCircle = useCallback((x: number, y: number): Position => {
    const maxX = Math.max(MARGIN, window.innerWidth - CIRCLE - MARGIN)
    const maxY = Math.max(MARGIN, window.innerHeight - CIRCLE - MARGIN)
    return { x: Math.min(Math.max(MARGIN, x), maxX), y: Math.min(Math.max(MARGIN, y), maxY) }
  }, [])

  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    function onResize() {
      setPosition((current) => clampCircle(current.x, current.y))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampCircle])

  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(false), 4200)
    return () => window.clearTimeout(timer)
  }, [hint])

  function startDrag(event: ReactPointerEvent, from: 'circle' | 'panel') {
    event.preventDefault()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    }

    function onMove(moveEvent: PointerEvent) {
      if (!dragRef.current) return
      const dx = moveEvent.clientX - dragRef.current.startX
      const dy = moveEvent.clientY - dragRef.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true
      const next = clampCircle(dragRef.current.originX + dx, dragRef.current.originY + dy)
      positionRef.current = next
      setPosition(next)
    }
    function onUp() {
      const drag = dragRef.current
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (drag?.moved) writePosition(positionRef.current)
      if (from === 'circle' && !drag?.moved) {
        setHint(false)
        setOpen((value) => !value)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const panelWidth = Math.min(680, Math.max(320, window.innerWidth - MARGIN * 2))
  const panelLeft = Math.min(
    Math.max(MARGIN, position.x + CIRCLE - panelWidth),
    Math.max(MARGIN, window.innerWidth - panelWidth - MARGIN),
  )
  const spaceAbove = position.y - MARGIN
  const spaceBelow = window.innerHeight - position.y - CIRCLE - MARGIN
  const placeAbove = spaceAbove >= 280 || spaceAbove >= spaceBelow
  const maxPanelHeight = Math.max(220, (placeAbove ? spaceAbove : spaceBelow) - 12)
  const panelHeight = Math.min(600, maxPanelHeight)
  const panelStyle = placeAbove
    ? { left: panelLeft, bottom: window.innerHeight - position.y + 12, height: panelHeight }
    : { left: panelLeft, top: position.y + CIRCLE + 12, height: panelHeight }

  return (
    <>
      {open ? (
        <div
          style={panelStyle}
          className="fixed z-40 flex w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-cream shadow-2xl"
        >
          <div
            onPointerDown={(event) => startDrag(event, 'panel')}
            className="flex shrink-0 cursor-grab touch-none items-center gap-2.5 border-b border-line bg-paper-2/70 px-3.5 py-2.5 active:cursor-grabbing"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forest text-cream">
              <SparkleIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">Asistente legal</p>
              <p className="truncate text-[11px] text-ink-soft">Código Civil de Yucatán</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar asistente"
              className="shrink-0 rounded-lg p-1.5 text-ink-soft hover:bg-paper hover:text-ink"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AskPanel projectId={projectId} />
          </div>
        </div>
      ) : null}

      {hint && !open ? (
        <div
          style={{
            left: Math.max(MARGIN, position.x + CIRCLE - 220),
            top: Math.max(MARGIN, position.y - 44),
          }}
          className="paper-shadow animate-in pointer-events-none fixed z-40 max-w-[220px] rounded-xl border border-line bg-cream px-3 py-2 text-xs text-ink-soft"
        >
          ¿Una duda legal? Pregúntame
        </div>
      ) : null}

      <button
        type="button"
        onPointerDown={(event) => startDrag(event, 'circle')}
        aria-label={open ? 'Cerrar asistente legal' : 'Abrir asistente legal'}
        style={{ left: position.x, top: position.y }}
        className="fixed z-40 flex h-14 w-14 cursor-grab touch-none items-center justify-center rounded-full bg-forest text-cream shadow-xl transition-transform hover:scale-105 active:cursor-grabbing active:scale-95"
      >
        {open ? <CloseIcon /> : <SparkleIcon />}
      </button>
    </>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 3l1.8 4.9L19 9.5l-5.2 1.6L12 16l-1.8-4.9L5 9.5l5.2-1.6L12 3z"
        fill="currentColor"
      />
      <path d="M18.5 15l.8 2.1 2.2.7-2.2.7-.8 2.1-.8-2.1-2.2-.7 2.2-.7.8-2.1z" fill="currentColor" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
