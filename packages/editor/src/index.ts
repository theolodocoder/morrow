export * from './schema.ts'
export * from './content.ts'
export * from './markdown.ts'
export * from './diff.ts'
export * from './nodes.ts'
/** true for a transaction that came from another writer (Yjs), not this editor's own typing */
export { isChangeOrigin } from '@tiptap/extension-collaboration'
