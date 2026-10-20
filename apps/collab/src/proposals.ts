/**
 * The proposal engine (architecture §9, spike S2): block identity signatures, classification, idempotent apply,
 * and refresh (bringing the latest chapter text into a proposal). Operates on Y.Docs only; the server wires it
 * to live documents and storage.
 */
import * as Y from 'yjs'
import { classify, type Block, type Classification } from '@morrow/domain'
import { CONTENT_FIELD, type PMNode } from '@morrow/editor'
import { documentToJSON, updateDocumentContent } from '@morrow/editor/server'

/** A frozen copy: safe to read or snapshot across awaits while the live document keeps changing. */
export function freeze(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

export function docFromState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return doc
}

/** Normalised ranges of live item ids ("client:from-to"), independent of how Yjs happened to split items. */
function liveRanges(start: Y.Item | null, out: string[]) {
  let cur: [number, number, number] | null = null
  for (let it: Y.Item | null = start; it; it = it.right) {
    if (it.deleted) continue
    const { client, clock } = it.id
    if (cur && cur[0] === client && cur[2] === clock) cur[2] += it.length
    else {
      if (cur) out.push(`${cur[0]}:${cur[1]}-${cur[2]}`)
      cur = [client, clock, clock + it.length]
    }
    const nested = (it.content as { type?: { _start?: Y.Item | null } }).type
    if (nested && '_start' in nested) {
      if (cur) out.push(`${cur[0]}:${cur[1]}-${cur[2]}`)
      cur = null
      out.push('(')
      liveRanges(nested._start ?? null, out)
      out.push(')')
    }
  }
  if (cur) out.push(`${cur[0]}:${cur[1]}-${cur[2]}`)
}

/** A block's CRDT identity: its element, its live attributes and every live item inside it (S2 finding 1). */
function signature(el: Y.XmlElement): string {
  const out: string[] = [`el:${el._item!.id.client}:${el._item!.id.clock}`]
  for (const [k, item] of [...el._map.entries()].sort(([a], [b]) => a.localeCompare(b)))
    if (!item.deleted) out.push(`@${k}=${item.id.client}:${item.id.clock}`)
  liveRanges(el._start, out)
  return out.join(' ')
}

export function blocksOf(doc: Y.Doc): Block[] {
  return doc
    .getXmlFragment(CONTENT_FIELD)
    .toArray()
    .filter((n): n is Y.XmlElement => n instanceof Y.XmlElement)
    .map((el, i) => ({ id: String(el.getAttribute('id') ?? `#${i}`), sig: signature(el) }))
}

export const classifyDocs = (base: Y.Doc, head: Y.Doc, workspace: Y.Doc): Classification =>
  classify(blocksOf(base), blocksOf(head), blocksOf(workspace))

const APPLIED = '__morrow_applied'
export const wasApplied = (head: Y.Doc, proposalId: string) => head.getMap(APPLIED).get(proposalId) === true

/**
 * Accept: re-classify against the live chapter and, unless it conflicts, apply the proposal's own changes (its Yjs
 * delta since the base) as one transaction. A retry after a partial failure finds the marker and applies nothing.
 */
export function applyProposal(
  head: Y.Doc,
  workspace: Y.Doc,
  base: Y.Doc,
  proposalId: string,
):
  | { applied: true; classification: Classification }
  | { applied: false; alreadyApplied: boolean; classification: Classification } {
  if (wasApplied(head, proposalId))
    return { applied: false, alreadyApplied: true, classification: { kind: 'clean' } }
  const classification = classifyDocs(base, head, workspace)
  if (classification.kind === 'conflict') return { applied: false, alreadyApplied: false, classification }
  const delta = Y.encodeStateAsUpdate(workspace, Y.encodeStateVector(base))
  const origin = `proposal:${proposalId}`
  head.transact(() => {
    Y.applyUpdate(head, delta, origin)
    head.getMap(APPLIED).set(proposalId, true)
  }, origin)
  return { applied: true, classification }
}

const blockList = (json: PMNode): PMNode[] => (json.content ?? []) as PMNode[]
const blockId = (n: PMNode) => String((n.attrs as { id?: unknown } | undefined)?.id ?? '')

/**
 * Refresh (T-005): merge the chapter's newer changes into the workspace. Where both sides changed the same block,
 * the proposal's own version is kept (re-applied as a forward edit) and the chapter's version is returned for the
 * author to reconcile by hand. Afterwards the caller re-bases the proposal on the chapter state it merged.
 */
export function refreshWorkspace(workspace: Y.Doc, head: Y.Doc, base: Y.Doc) {
  const classification = classifyDocs(base, head, workspace)
  const conflictIds = new Set(classification.kind === 'conflict' ? classification.blockIds : [])
  const mine = blockList(documentToJSON(workspace))
  const theirs = new Map(blockList(documentToJSON(head)).map((n) => [blockId(n), n]))

  Y.applyUpdate(workspace, Y.encodeStateAsUpdate(head, Y.encodeStateVector(workspace)), 'morrow:refresh')

  const reference: { blockId: string; chapter: PMNode | null; proposal: PMNode | null }[] = []
  if (conflictIds.size) {
    const merged = blockList(documentToJSON(workspace))
    for (const id of conflictIds) {
      const own = mine.find((n) => blockId(n) === id) ?? null
      reference.push({ blockId: id, chapter: theirs.get(id) ?? null, proposal: own })
      if (!own) continue // the proposal deleted it; the merge kept that deletion
      const at = merged.findIndex((n) => blockId(n) === id)
      if (at >= 0) merged[at] = own
      else {
        // The chapter deleted a block the proposal rewrote: put the proposal's version back after its predecessor.
        const before = mine
          .slice(0, mine.indexOf(own))
          .reverse()
          .find((n) => merged.some((m) => blockId(m) === blockId(n)))
        merged.splice(before ? merged.findIndex((m) => blockId(m) === blockId(before)) + 1 : 0, 0, own)
      }
    }
    updateDocumentContent(workspace, { type: 'doc', content: merged }, 'morrow:refresh-resolve')
  }
  return { classification, reference }
}

/**
 * Accept a conflicting proposal on the reviewer's say-so, using the proposal's wording where both sides changed the
 * same paragraph (the reviewer has seen both side by side). The merge is built on a private frozen copy (the
 * workspace is never touched, so nothing of the draft reaches an outside contributor) and the chapter is brought to
 * that result with the smallest edit: the chapter's other changes stay, each with its identity. Idempotent.
 */
export function applyUsingProposal(head: Y.Doc, workspace: Y.Doc, base: Y.Doc, proposalId: string) {
  if (wasApplied(head, proposalId)) return { applied: false as const, alreadyApplied: true }
  const merged = freeze(workspace)
  const chapter = freeze(head)
  const { reference } = refreshWorkspace(merged, chapter, base)
  const origin = `proposal:${proposalId}`
  head.transact(() => {
    updateDocumentContent(head, documentToJSON(merged), origin)
    head.getMap(APPLIED).set(proposalId, true)
  }, origin)
  merged.destroy()
  chapter.destroy()
  return { applied: true as const, contested: reference.length }
}
