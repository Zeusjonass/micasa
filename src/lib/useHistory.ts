import { useCallback, useRef, useState } from 'react'

export function useHistory<T>(limit = 40) {
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const sync = useCallback(() => {
    setCanUndo(past.current.length > 0)
    setCanRedo(future.current.length > 0)
  }, [])

  const push = useCallback(
    (snapshot: T) => {
      past.current = [...past.current, snapshot].slice(-limit)
      future.current = []
      sync()
    },
    [limit, sync],
  )

  const undo = useCallback(
    (current: T): T | null => {
      const previous = past.current.at(-1)
      if (!previous) return null
      past.current = past.current.slice(0, -1)
      future.current = [...future.current, current]
      sync()
      return previous
    },
    [sync],
  )

  const redo = useCallback(
    (current: T): T | null => {
      const next = future.current.at(-1)
      if (!next) return null
      future.current = future.current.slice(0, -1)
      past.current = [...past.current, current]
      sync()
      return next
    },
    [sync],
  )

  const reset = useCallback(() => {
    past.current = []
    future.current = []
    sync()
  }, [sync])

  return { push, undo, redo, reset, canUndo, canRedo }
}
