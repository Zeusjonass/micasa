import { DEFAULT_CLOSING, DISCLAIMER, type DocumentFooter } from '../types'

export const EMPH_OPEN = '\u0001'
export const EMPH_CLOSE = '\u0002'

export type EmphasisRun = {
  text: string
  emphasize?: boolean
}

export function officialValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '[por definir]') return trimmed || '[por definir]'
  return `${EMPH_OPEN}${trimmed.toLocaleUpperCase('es-MX')}${EMPH_CLOSE}`
}

export function splitEmphasis(text: string): EmphasisRun[] {
  const runs: EmphasisRun[] = []
  const pattern = /\u0001([^\u0001\u0002]*)\u0002/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index) })
    if (match[1]) runs.push({ text: match[1], emphasize: true })
    last = match.index + match[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs.filter((run) => run.text)
}

export function stripEmphasis(text: string): string {
  return text.replaceAll(EMPH_OPEN, '').replaceAll(EMPH_CLOSE, '')
}

/** Parte una lista de personas: "A, B y C" → ["A", "B", "C"]. */
export function splitPartyNames(raw: string): string[] {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text || /^_+$/.test(text)) return []
  const chunks = text.split(/[,;/]+/).map((part) => part.trim()).filter(Boolean)
  const names: string[] = []
  for (const chunk of chunks) {
    names.push(...splitOnConjunction(chunk))
  }
  return names.map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function splitOnConjunction(part: string): string[] {
  const match = part.match(/^(.*?)\s+(?:y|e)\s+(.*)$/i)
  if (!match) return [part]
  const left = match[1].trim()
  const right = match[2].trim()
  if (left.split(' ').length >= 2 && right.split(' ').length >= 2) {
    return [...splitOnConjunction(left), ...splitOnConjunction(right)]
  }
  return [part]
}

export function joinPartyNames(names: string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) return `${clean[0]} y ${clean[1]}`
  return `${clean.slice(0, -1).join(', ')} y ${clean[clean.length - 1]}`
}

export function pluralPartyLabel(label: string, count: number): string {
  if (count <= 1) return label
  const key = label.toLocaleUpperCase('es-MX')
  const map: Record<string, string> = {
    'EL VENDEDOR': 'LOS VENDEDORES',
    'EL PROMITENTE VENDEDOR': 'LOS PROMITENTES VENDEDORES',
    'EL COMPRADOR': 'LOS COMPRADORES',
    'EL ARRENDADOR': 'LOS ARRENDADORES',
    'EL ARRENDATARIO': 'LOS ARRENDATARIOS',
  }
  return map[key] || label
}

export function signatureParties(
  type: 'renta' | 'venta',
  slots: Record<string, string>,
): { leftLabel: string; rightLabel: string; left: string; right: string } {
  if (type === 'renta') {
    return {
      leftLabel: 'EL ARRENDADOR',
      rightLabel: 'EL ARRENDATARIO',
      left: (slots.arrendador || '').toLocaleUpperCase('es-MX'),
      right: (slots.arrendatario || '').toLocaleUpperCase('es-MX'),
    }
  }
  return {
    leftLabel: 'EL VENDEDOR',
    rightLabel: 'EL COMPRADOR',
    left: (slots.vendedor || '').toLocaleUpperCase('es-MX'),
    right: (slots.comprador || '').toLocaleUpperCase('es-MX'),
  }
}

export function resolveFooter(
  type: 'renta' | 'venta',
  slots: Record<string, string>,
  stored?: DocumentFooter | null,
): DocumentFooter {
  const parties = signatureParties(type, slots)
  const leftSigners = Array.isArray(stored?.leftSigners)
    ? stored.leftSigners.map((name) => name.trim())
    : splitPartyNames(parties.left || stored?.leftName || '')
  const rightSigners = Array.isArray(stored?.rightSigners)
    ? stored.rightSigners.map((name) => name.trim())
    : splitPartyNames(parties.right || stored?.rightName || '')
  return {
    disclaimer: stored?.disclaimer || DISCLAIMER,
    closing: stored?.closing || DEFAULT_CLOSING,
    heading: stored?.heading || '',
    leftLabel: stored?.leftLabel || parties.leftLabel,
    rightLabel: stored?.rightLabel || parties.rightLabel,
    leftName: joinPartyNames(leftSigners),
    rightName: joinPartyNames(rightSigners),
    leftSigners,
    rightSigners,
    leftHidden: Boolean(stored?.leftHidden),
    rightHidden: Boolean(stored?.rightHidden),
  }
}

export function slotsFromFooter(
  type: 'renta' | 'venta',
  footer: DocumentFooter,
): Record<string, string> {
  const left = joinPartyNames(footer.leftSigners ?? splitPartyNames(footer.leftName))
  const right = joinPartyNames(footer.rightSigners ?? splitPartyNames(footer.rightName))
  if (type === 'renta') {
    return {
      ...(left ? { arrendador: left } : {}),
      ...(right ? { arrendatario: right } : {}),
    }
  }
  return {
    ...(left ? { vendedor: left } : {}),
    ...(right ? { comprador: right } : {}),
  }
}
