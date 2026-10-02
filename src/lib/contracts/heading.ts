import type { ContractType } from '../types'

/**
 * El backend es la única fuente de verdad para el contenido legal (cláusulas,
 * plantillas, reglas). Esto es solo el rótulo de portada para el render de
 * PDF/Word/documento en pantalla, no una decisión de negocio.
 */
const HEADINGS: Record<ContractType, string> = {
  renta: 'CONTRATO DE ARRENDAMIENTO DE CASA HABITACIÓN',
  venta: 'CONTRATO DE COMPRAVENTA DE CASA HABITACIÓN',
}

export function contractHeading(type: ContractType, stored?: string | null): string {
  const value = (stored || '').trim()
  return value || HEADINGS[type]
}
