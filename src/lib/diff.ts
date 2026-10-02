import { stripEmphasis } from './contracts/emphasis'
import type { Clause } from './types'

export type DiffPart = {
  type: 'eq' | 'del' | 'ins'
  text: string
}

export type ClauseHunk =
  | { type: 'same'; id: string; clause: Clause }
  | { type: 'edit'; id: string; before: Clause; after: Clause }
  | { type: 'add'; id: string; clause: Clause }
  | { type: 'remove'; id: string; clause: Clause }

export type HunkDecision = 'accept' | 'reject'

export function sameClause(left: Clause, right: Clause): boolean {
  return (
    left.id === right.id &&
    stripEmphasis(left.title) === stripEmphasis(right.title) &&
    stripEmphasis(left.body) === stripEmphasis(right.body)
  )
}

export function clausesEqual(left: Clause[], right: Clause[]): boolean {
  if (left.length !== right.length) return false
  return left.every((clause, index) => sameClause(clause, right[index]))
}

export function alignClauses(base: Clause[], proposed: Clause[]): ClauseHunk[] {
  const proposedIds = new Set(proposed.map((clause) => clause.id))
  const baseMap = new Map(base.map((clause) => [clause.id, clause]))
  const hunks: ClauseHunk[] = []
  let baseCursor = 0

  for (const clause of proposed) {
    while (baseCursor < base.length && !proposedIds.has(base[baseCursor].id)) {
      hunks.push({ type: 'remove', id: base[baseCursor].id, clause: base[baseCursor] })
      baseCursor += 1
    }
    if (base[baseCursor]?.id === clause.id) baseCursor += 1
    const previous = baseMap.get(clause.id)
    if (!previous) hunks.push({ type: 'add', id: clause.id, clause })
    else if (sameClause(previous, clause)) hunks.push({ type: 'same', id: clause.id, clause })
    else hunks.push({ type: 'edit', id: clause.id, before: previous, after: clause })
  }
  while (baseCursor < base.length) {
    if (!proposedIds.has(base[baseCursor].id)) {
      hunks.push({ type: 'remove', id: base[baseCursor].id, clause: base[baseCursor] })
    }
    baseCursor += 1
  }
  return hunks
}

export function pendingHunks(hunks: ClauseHunk[]): ClauseHunk[] {
  return hunks.filter((hunk) => hunk.type !== 'same')
}

export function applyDecisions(
  hunks: ClauseHunk[],
  decisions: Record<string, HunkDecision>,
  fallback?: HunkDecision,
): Clause[] {
  const result: Clause[] = []
  for (const hunk of hunks) {
    const decision = hunk.type === 'same' ? 'accept' : (decisions[hunk.id] ?? fallback)
    if (hunk.type === 'same') {
      result.push(hunk.clause)
      continue
    }
    if (!decision) continue
    if (hunk.type === 'edit') result.push(decision === 'reject' ? hunk.before : hunk.after)
    else if (hunk.type === 'add' && decision !== 'reject') result.push(hunk.clause)
    else if (hunk.type === 'remove' && decision !== 'accept') result.push(hunk.clause)
  }
  return result
}

export function diffWords(before: string, after: string): DiffPart[] {
  const left = before.split(/(\s+)/)
  const right = after.split(/(\s+)/)
  const rows = left.length
  const cols = right.length
  const table: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (left[i] === right[j]) {
      parts.push({ type: 'eq', text: left[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      parts.push({ type: 'del', text: left[i] })
      i += 1
    } else {
      parts.push({ type: 'ins', text: right[j] })
      j += 1
    }
  }
  while (i < rows) {
    parts.push({ type: 'del', text: left[i] })
    i += 1
  }
  while (j < cols) {
    parts.push({ type: 'ins', text: right[j] })
    j += 1
  }
  return mergeAdjacent(parts.filter((part) => part.text))
}

function mergeAdjacent(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = []
  for (const part of parts) {
    const last = merged[merged.length - 1]
    if (last && last.type === part.type) last.text += part.text
    else merged.push({ ...part })
  }
  return merged
}
