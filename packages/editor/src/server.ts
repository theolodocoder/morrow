// Server-side document utilities for the collaboration service: schema, Y.Doc ⇄ JSON, projection.
import { getSchema } from '@tiptap/core'
import {
  prosemirrorJSONToYDoc,
  prosemirrorJSONToYXmlFragment,
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { CONTENT_FIELD, manuscriptExtensions } from './schema.ts'
import { findDuplicateBlockIds, plainText, wordCount, type PMNode } from './content.ts'

export const manuscriptSchema = getSchema(manuscriptExtensions())

export function documentToJSON(doc: Y.Doc): PMNode {
  return yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(CONTENT_FIELD)) as PMNode
}

/** Build a Y.Doc from ProseMirror JSON, validating it against the schema first. */
export function documentFromJSON(json: PMNode): Y.Doc {
  manuscriptSchema.nodeFromJSON(json).check() // throws on content the schema does not allow
  return prosemirrorJSONToYDoc(manuscriptSchema, json, CONTENT_FIELD)
}

export interface Projection {
  contentJson: PMNode
  plainText: string
  wordCount: number
  duplicateBlockIds: string[]
}

export function project(doc: Y.Doc): Projection {
  const contentJson = documentToJSON(doc)
  const text = plainText(contentJson)
  return {
    contentJson,
    plainText: text,
    wordCount: wordCount(text),
    duplicateBlockIds: findDuplicateBlockIds(contentJson),
  }
}

/** Fixed Yjs client id for server seeding. Real clients get random 32-bit ids, so collisions don't arise in practice. */
const SEED_CLIENT_ID = 1

/**
 * Initial state for a brand-new chapter: one empty paragraph. Seeding on the server stops each browser
 * editor from inserting its own "first paragraph" into an empty document, which produced stray empty
 * blocks. The bytes are deterministic (fixed client id, block id derived from the document id), so two
 * collab instances seeding the same document produce identical items that merge into one.
 */
export function initialDocumentState(documentId: string): Uint8Array {
  const doc = new Y.Doc()
  doc.clientID = SEED_CLIENT_ID
  prosemirrorJSONToYXmlFragment(
    manuscriptSchema,
    { type: 'doc', content: [{ type: 'paragraph', attrs: { id: `${documentId}:p0` } }] },
    doc.getXmlFragment(CONTENT_FIELD),
  )
  const state = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return state
}

/**
 * Replace a live document's content with `json` as a forward change (restore, architecture §7). Connected clients
 * receive it like any other edit, so nothing diverges; history stays linear. Block ids in `json` are preserved.
 */
export function replaceDocumentContent(doc: Y.Doc, json: PMNode, origin: unknown = 'morrow:replace') {
  manuscriptSchema.nodeFromJSON(json).check()
  const fragment = doc.getXmlFragment(CONTENT_FIELD)
  doc.transact(() => {
    fragment.delete(0, fragment.length)
    prosemirrorJSONToYXmlFragment(manuscriptSchema, json, fragment)
  }, origin)
}

/**
 * Bring a live document to `json` with the smallest change: blocks that already match keep their Yjs items (and so
 * their identity), changed blocks are edited in place. Used where identity matters, e.g. reconciling a proposal.
 */
export function updateDocumentContent(doc: Y.Doc, json: PMNode, origin: unknown = 'morrow:update') {
  const node = manuscriptSchema.nodeFromJSON(json)
  node.check()
  doc.transact(() => {
    updateYFragment(doc, doc.getXmlFragment(CONTENT_FIELD), node, { mapping: new Map(), isOMark: new Map() })
  }, origin)
}
