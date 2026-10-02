import { useEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from 'react'

type AutoGrowTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  maxHeight?: number
}

/** Textarea que crece con el texto, sin scroll interno hasta un tope. */
export function AutoGrowTextarea({
  value,
  maxHeight = 168,
  className,
  onKeyDown,
  ...props
}: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, maxHeight])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event)
  }

  return (
    <textarea
      {...props}
      ref={ref}
      rows={1}
      value={value}
      onKeyDown={handleKeyDown}
      className={`min-w-0 w-full resize-none overflow-hidden break-words ${className ?? ''}`}
    />
  )
}
