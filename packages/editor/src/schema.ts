/**
 * The manuscript document schema, shared by the browser editor and the collaboration server.
 *
 * Every node and mark here becomes part of stored documents. Adding is safe; renaming or removing needs a
 * migration job and a SCHEMA_VERSION bump released together across web and collab (architecture §7).
 * Clients on an older SCHEMA_VERSION are refused edit access: y-prosemirror deletes content it cannot
 * represent, for every peer (spike S1/S2 findings).
 */
import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import UniqueID from '@tiptap/extension-unique-id'
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Callout, Divider, Note, SceneBreak, Verse } from './nodes.ts'
import type * as Y from 'yjs'

/**
 * v2 (PRD FR-007): underline, strike, inline code and code blocks.
 * v3: the forms of writing: heading level 4, highlight, super/subscript, scene breaks, verse, callouts, tables,
 * checklists, footnotes and citations. Additive: v1 and v2 documents load unchanged.
 */
export const SCHEMA_VERSION = 3

/** The Y.XmlFragment field that holds a chapter's content. */
export const CONTENT_FIELD = 'default'

/** Top-level block types that carry a stable id (diffs, proposals, comments and attribution rely on it). */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'codeBlock',
  'sceneBreak',
  'verse',
  'callout',
  'table',
  'taskList',
] as const

export const ALLOWED_LINK_PROTOCOLS = ['http', 'https', 'mailto'] as const

export interface ManuscriptExtensionsOptions {
  /** Bind the editor to a shared Y.Doc. Omit for the read-only server-side schema. */
  collaboration?: { document: Y.Doc }
}

export function manuscriptExtensions(options: ManuscriptExtensionsOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      // The chapter title is metadata, rendered outside the document; papers need a third level (sections,
      // subsections, sub-subsections).
      heading: { levels: [2, 3, 4] },
      horizontalRule: false, // replaced by Divider, so "***" can mean a scene break
      // Code blocks keep their text plain; no syntax highlighting (no extra dependency, nothing to sanitize).
      codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
      // Yjs supplies undo/redo when collaborating; ProseMirror history would fight it.
      undoRedo: options.collaboration ? false : undefined,
      link: {
        openOnClick: false,
        autolink: true,
        protocols: [...ALLOWED_LINK_PROTOCOLS],
        isAllowedUri: (url) => isSafeLinkUrl(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow ugc', target: null },
      },
    }),
    Highlight,
    Superscript,
    Subscript,
    TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: 'manuscript-table' } } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Divider,
    SceneBreak,
    Verse,
    Callout,
    Note,
    UniqueID.configure({
      types: [...BLOCK_TYPES],
      // Ids arriving from other replicas are already final; regenerating them would fork identity.
      filterTransaction: (tr) => !isChangeOrigin(tr),
    }),
    ...(options.collaboration
      ? [Collaboration.configure({ document: options.collaboration.document, field: CONTENT_FIELD })]
      : []),
  ]
}

export function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(parsed.protocol.replace(/:$/, ''))
  } catch {
    return false
  }
}
