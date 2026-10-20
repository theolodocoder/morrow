/**
 * Display diff between two manuscript documents (proposal review, FR-015 "compare proposed and current text").
 * Blocks are matched by their stable ids; inside a changed block, words are compared. Pure JSON, no Yjs: this
 * is what readers see, while accept/reject decisions use CRDT identity (architecture §9).
 */
import { plainText, type PMNode } from './content.ts'

export type WordOp = { op: 'same' | 'added' | 'removed'; text: string }
export type BlockChange =
  | { type: 'same'; id: string; block: PMNode }
  | { type: 'added'; id: string; block: PMNode }
  | { type: 'removed'; id: string; block: PMNode }
  | { type: 'changed'; id: string; before: PMNode; after: PMNode; words: WordOp[] }

const idOf = (n: PMNode, i: number) => (typeof n.attrs?.id === 'string' ? n.attrs.id : `#${i}`)
const blockText = (n: PMNode) => plainText({ type: 'doc', content: [n] })

function lcsPairs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const out: [number, number][] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (eq(a[i]!, b[j]!)) out.push([i++, j++])
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  return out
}

/**
 * Key-order-independent comparison. Stored JSON (Postgres jsonb) reorders object keys, while live documents don't,
 * so plain JSON.stringify would call identical paragraphs "changed".
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}
export const sameContent = (a: PMNode, b: PMNode) => canonical(a) === canonical(b)

const MAX_TOKENS = 1500

/** Word-level diff; whitespace stays attached so the result reads naturally when rendered inline. */
export function diffWords(before: string, after: string): WordOp[] {
  const a = before.split(/(\s+)/).filter(Boolean)
  const b = after.split(/(\s+)/).filter(Boolean)
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS)
    return [
      { op: 'removed', text: before },
      { op: 'added', text: after },
    ]
  const out: WordOp[] = []
  const push = (op: WordOp['op'], text: string) => {
    const last = out.at(-1)
    if (last?.op === op) last.text += text
    else out.push({ op, text })
  }
  let i = 0
  let j = 0
  for (const [pi, pj] of lcsPairs(a, b, (x, y) => x === y)) {
    while (i < pi) push('removed', a[i++]!)
    while (j < pj) push('added', b[j++]!)
    push('same', a[i++]!)
    j++
  }
  while (i < a.length) push('removed', a[i++]!)
  while (j < b.length) push('added', b[j++]!)
  return groupChanges(out)
}

/**
 * Read as a reviewer would: whitespace alone between two edits doesn't split them, so "did not look" → "never
 * looked" shows as one replacement instead of four fragments. Within a run, removed text comes before added text.
 */
function groupChanges(ops: WordOp[]): WordOp[] {
  const out: WordOp[] = []
  let removed = ''
  let added = ''
  const flush = () => {
    if (removed) out.push({ op: 'removed', text: removed })
    if (added) out.push({ op: 'added', text: added })
    removed = added = ''
  }
  ops.forEach((o, k) => {
    const inRun = removed !== '' || added !== ''
    const nextIsChange = ops[k + 1] !== undefined && ops[k + 1]!.op !== 'same'
    if (o.op === 'removed') removed += o.text
    else if (o.op === 'added') added += o.text
    else if (inRun && nextIsChange && !o.text.trim()) {
      removed += o.text
      added += o.text
    } else {
      flush()
      out.push(o)
    }
  })
  flush()
  return out
}

export function diffDocuments(before: PMNode, after: PMNode): BlockChange[] {
  const a = before.content ?? []
  const b = after.content ?? []
  const aIds = a.map(idOf)
  const bIds = b.map(idOf)
  const out: BlockChange[] = []
  let i = 0
  let j = 0
  const pairs = lcsPairs(aIds, bIds, (x, y) => x === y)
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    while (i < pi) out.push({ type: 'removed', id: aIds[i]!, block: a[i++]! })
    while (j < pj) out.push({ type: 'added', id: bIds[j]!, block: b[j++]! })
    if (pi === a.length) break
    const x = a[i++]!
    const y = b[j++]!
    if (sameContent(x, y)) out.push({ type: 'same', id: aIds[pi]!, block: y })
    else
      out.push({
        type: 'changed',
        id: aIds[pi]!,
        before: x,
        after: y,
        words: diffWords(blockText(x), blockText(y)),
      })
  }
  return out
}

/** "3 paragraphs changed, 1 added" style summary counts. */
export function diffSummary(changes: BlockChange[]) {
  const count = (t: BlockChange['type']) => changes.filter((c) => c.type === t).length
  return { changed: count('changed'), added: count('added'), removed: count('removed') }
}
