export function uid(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function padVersion(version: number): string {
  return `v${String(version).padStart(4, '0')}`
}

export function formatClock(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Hace ${hours} h`
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}
