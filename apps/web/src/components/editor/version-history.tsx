'use client'
import { useCallback, useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { RevisionCompare, Snapshot } from '@morrow/contracts'
import type { BlockChange } from '@morrow/editor'
import { DiffView } from '@/components/diff/diff-view'
import { manuscriptExtensions } from '@morrow/editor'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'
import { SkeletonRows } from '@/components/ui/skeleton'

const when = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const REASON: Record<Snapshot['reason'], string> = {
  auto: 'Autosave',
  manual: 'Saved version',
  publish: 'Published',
  proposal_base: 'Proposal base',
  proposal_applied: 'Proposal accepted',
  branch_fork: 'Branched',
  pre_restore: 'Before restore',
  pre_migration: 'Before update',
}

/**
 * Two tiers (design system §9): named versions are always visible, autosaves fold under a toggle.
 * Restoring arrives in M3; M1 lists and previews.
 */
export function VersionHistory({
  documentId,
  canSave,
  onSnapshot,
}: {
  documentId: string
  canSave: boolean
  onSnapshot: (cb: () => void) => () => void
}) {
  const [items, setItems] = useState<Snapshot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAuto, setShowAuto] = useState(false)
  const [preview, setPreview] = useState<{ snapshot: Snapshot; content: unknown } | null>(null)
  const previousOf = (s: Snapshot) => {
    const i = items?.findIndex((x) => x.id === s.id) ?? -1
    return i >= 0 ? (items?.[i + 1] ?? null) : null
  }

  const load = useCallback(
    () =>
      api<{ items: Snapshot[] }>(`/documents/${documentId}/snapshots`).then(
        (r) => setItems(r.items),
        () => setError('Couldn’t load versions.'),
      ),
    [documentId],
  )
  useEffect(() => {
    void load()
    return onSnapshot(() => void load())
  }, [load, onSnapshot])

  const save = async () => {
    const label = window.prompt('Name this version (optional)') ?? undefined
    try {
      await api(`/documents/${documentId}/snapshots`, { method: 'POST', body: label ? { label } : {} })
      await load()
    } catch {
      setError('Couldn’t save this version.')
    }
  }

  // Restore is a new change (FR-019): what it replaces is kept as a "Before restore" version.
  const restore = async (snap: Snapshot) => {
    if (
      !window.confirm(
        'Restore this version? The current text is kept in history as “Before restore”, so you can undo this.',
      )
    )
      return
    try {
      await api(`/documents/${documentId}/restore`, { method: 'POST', body: { snapshotId: snap.id } })
      setPreview(null)
      await load()
    } catch {
      setError('Couldn’t restore that version.')
    }
  }

  const named = items?.filter((s) => s.reason !== 'auto') ?? []
  const autos = items?.filter((s) => s.reason === 'auto') ?? []

  return (
    <section aria-label="Version history" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">Versions</p>
        {canSave && (
          <Button size="sm" variant="secondary" onPress={save}>
            Save version
          </Button>
        )}
      </div>
      {error && (
        <div className="px-4">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {items === null ? (
          <div className="px-2">
            <SkeletonRows count={3} avatar={false} />
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-2 text-sm text-secondary">
            No versions yet. Morrow saves one when you finish a session, and you can save named versions any
            time.
          </p>
        ) : (
          <ul>
            {named.map((s) => (
              <VersionRow key={s.id} s={s} onPreview={setPreview} />
            ))}
            {autos.length > 0 && (
              <li>
                <button
                  type="button"
                  className="w-full px-2 py-2 text-left text-[13px] text-secondary hover:text-primary"
                  aria-expanded={showAuto}
                  onClick={() => setShowAuto(!showAuto)}
                >
                  {showAuto ? 'Hide' : 'Show'} {autos.length} autosave{autos.length === 1 ? '' : 's'}
                </button>
              </li>
            )}
            {showAuto && autos.map((s) => <VersionRow key={s.id} s={s} onPreview={setPreview} />)}
          </ul>
        )}
      </div>
      {preview && (
        <SnapshotPreview
          documentId={documentId}
          snapshot={preview.snapshot}
          previous={previousOf(preview.snapshot)}
          content={preview.content}
          title={preview.snapshot.label ?? REASON[preview.snapshot.reason]}
          onClose={() => setPreview(null)}
          {...(canSave ? { onRestore: () => restore(preview.snapshot) } : {})}
        />
      )}
    </section>
  )
}

function VersionRow({
  s,
  onPreview,
}: {
  s: Snapshot
  onPreview: (p: { snapshot: Snapshot; content: unknown }) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={async () =>
          onPreview({ snapshot: s, content: (await api<{ content: unknown }>(`/snapshots/${s.id}`)).content })
        }
        className="flex w-full flex-col rounded-sm px-2 py-2 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="text-sm text-primary">{s.label ?? REASON[s.reason]}</span>
        <span className="font-mono text-[11px] text-tertiary">
          {when.format(new Date(s.createdAt))} · {s.wordCount} words
        </span>
        {s.createdByName && <span className="text-[12px] text-secondary">by {s.createdByName}</span>}
      </button>
    </li>
  )
}

/** Read-only preview rendered through the schema, never through stored HTML (architecture §17). */
type View = 'version' | 'since-previous' | 'to-now'

/**
 * A version, read-only, rendered through the schema (never stored HTML, architecture §17), or compared word by word
 * with the version before it or with the text as it is now (FR-019 "compare revisions").
 */
function SnapshotPreview({
  documentId,
  snapshot,
  previous,
  content,
  title,
  onClose,
  onRestore,
}: {
  documentId: string
  snapshot: Snapshot
  previous: Snapshot | null
  content: unknown
  title: string
  onClose: () => void
  onRestore?: () => void
}) {
  const [view, setView] = useState<View>('version')
  const [compare, setCompare] = useState<RevisionCompare | null>(null)
  const [failed, setFailed] = useState(false)
  const editor = useEditor({
    extensions: manuscriptExtensions(),
    content: content as object,
    editable: false,
    immediatelyRender: false,
  })
  useEffect(() => {
    setCompare(null)
    setFailed(false)
    if (view === 'version') return
    const q = view === 'to-now' ? `from=${snapshot.id}` : `from=${previous!.id}&to=${snapshot.id}`
    api<RevisionCompare>(`/documents/${documentId}/compare?${q}`).then(setCompare, () => setFailed(true))
  }, [view, documentId, snapshot.id, previous])

  const views: { id: View; label: string }[] = [
    { id: 'version', label: 'This version' },
    ...(previous ? [{ id: 'since-previous' as const, label: 'Changes in it' }] : []),
    { id: 'to-now', label: 'Compare with now' },
  ]
  const s = compare?.summary
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-canvas">
      <div className="flex items-center justify-between border-b border-subtle px-4 py-2">
        <p className="min-w-0 truncate text-sm font-medium">{title}</p>
        <div className="flex shrink-0 gap-1">
          {onRestore && (
            <Button size="sm" variant="secondary" onPress={onRestore}>
              Restore
            </Button>
          )}
          <Button size="sm" variant="quiet" onPress={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div role="group" aria-label="Show" className="flex gap-1 border-b border-subtle px-3 py-1.5">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className="rounded-sm px-2 py-1 text-[13px] text-secondary outline-none hover:bg-hover aria-pressed:bg-selected aria-pressed:text-primary focus-visible:ring-2 focus-visible:ring-focus"
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {view === 'version' ? (
          <div className="manuscript text-[16px]">
            <EditorContent editor={editor} />
          </div>
        ) : failed ? (
          <InlineAlert>Couldn’t compare these versions.</InlineAlert>
        ) : !compare ? (
          <p className="text-sm text-tertiary">Comparing…</p>
        ) : (
          <>
            <p className="mb-4 text-[13px] text-secondary" role="status">
              {s!.changed + s!.added + s!.removed === 0
                ? 'No differences.'
                : [
                    s!.changed && `${s!.changed} changed`,
                    s!.added && `${s!.added} added`,
                    s!.removed && `${s!.removed} removed`,
                  ]
                    .filter(Boolean)
                    .join(' · ') + ` (from “${compare.from.label}” to “${compare.to.label}”)`}
            </p>
            <div className="text-[16px]">
              <DiffView changes={compare.changes as BlockChange[]} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
