'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MergeResult } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { BranchIcon, CheckIcon, ReopenIcon } from '@/components/ui/icons'
import { api, newIdempotencyKey } from '@/lib/client-api'
import { routes } from '@/lib/routes'

const OUTCOME: Record<MergeResult['chapters'][number]['outcome'], string> = {
  merged: 'Merged',
  added: 'Added',
  unchanged: 'No changes',
  conflict: 'Conflict',
  kept: 'Kept as is',
  not_attempted: 'Not merged',
}

/**
 * Merge a branch into its parent (FR-018), with the consequence stated first. A conflict merges nothing; the way
 * forward is "Update from Main", which brings Main's changes into the branch and keeps the branch's own wording
 * where both changed the same paragraph, so the writer reviews those before merging again.
 */
export function MergePanel({
  workId,
  branchId,
  branchName,
  parentName,
  canMerge,
  mainChapterHref,
}: {
  workId: string
  branchId: string
  branchName: string
  parentName: string
  canMerge: boolean
  mainChapterHref: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'merge' | 'update' | null>(null)
  const [result, setResult] = useState<MergeResult | null>(null)
  const [updated, setUpdated] = useState<{ title: string; contested: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function merge() {
    setBusy('merge')
    setError(null)
    try {
      const r = await api<MergeResult>(`/branches/${branchId}/merge`, {
        method: 'POST',
        body: {},
        headers: { 'idempotency-key': newIdempotencyKey() },
      })
      setResult(r)
      setConfirming(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(null)
    }
  }
  async function update() {
    setBusy('update')
    setError(null)
    try {
      const r = await api<{ chapters: { title: string; contested: number }[] }>(
        `/branches/${branchId}/update-from-parent`,
        { method: 'POST', body: {} },
      )
      setUpdated(r.chapters)
      setResult(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(null)
    }
  }

  const contested = updated?.reduce((n, c) => n + c.contested, 0) ?? 0
  return (
    <section aria-label="Merge" className="flex flex-col gap-3 rounded-md border border-subtle bg-canvas p-4">
      {error && <InlineAlert>{error}</InlineAlert>}
      {!canMerge ? (
        <p className="text-[13px] text-secondary">
          Only people who can write in {parentName} can merge into it.
        </p>
      ) : result?.status === 'merged' ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="inline-flex items-center gap-1.5 font-medium text-success">
            <CheckIcon size={16} />
            Merged into {parentName}
          </p>
          <ResultList result={result} />
          <a href={mainChapterHref} className="text-[13px] text-accent underline underline-offset-2">
            Open {parentName}
          </a>
        </div>
      ) : result ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="font-medium text-primary">
            {result.status === 'conflict' ? 'Nothing was merged' : 'Merged partly'}
          </p>
          <p className="text-[13px] text-secondary">
            {parentName} changed some of the same paragraphs since this branch last caught up. Update the
            branch with {parentName}’s changes, review the paragraphs you both changed, then merge again.
          </p>
          <ResultList result={result} />
          <Button variant="primary" isDisabled={busy !== null} onPress={() => void update()}>
            <ReopenIcon size={16} />
            {busy === 'update' ? 'Updating…' : `Update from ${parentName}`}
          </Button>
        </div>
      ) : confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-primary">
            Apply “{branchName}” to {parentName}? Changed chapters are updated and new ones added; nothing in{' '}
            {parentName} is deleted. If anything clashes with newer changes in {parentName}, nothing is
            merged.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onPress={() => setConfirming(false)}>
              Back
            </Button>
            <Button variant="primary" isDisabled={busy !== null} onPress={() => void merge()}>
              {busy === 'merge' ? 'Merging…' : 'Merge'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {updated && (
            <p role="status" className="text-[13px] text-secondary">
              Updated from {parentName}.{' '}
              {contested
                ? `In ${contested} paragraph${contested === 1 ? '' : 's'} you both changed, the branch kept its own wording: review ${contested === 1 ? 'it' : 'them'} before merging, because merging will use the branch’s wording there.`
                : 'Nothing clashed.'}
            </p>
          )}
          <Button variant="primary" onPress={() => setConfirming(true)}>
            <BranchIcon size={16} />
            Merge into {parentName}…
          </Button>
          <p className="text-[12px] text-tertiary">
            Or keep writing here:{' '}
            <a className="underline underline-offset-2" href={routes.branch(workId, branchId)}>
              back to the branch
            </a>
            .
          </p>
        </div>
      )}
    </section>
  )
}

function ResultList({ result }: { result: MergeResult }) {
  return (
    <ul className="flex flex-col gap-1 text-[13px]">
      {result.chapters.map((c, i) => (
        <li key={`${c.title}-${i}`} className="flex justify-between gap-3">
          <span className="truncate text-primary">{c.title}</span>
          <span className={c.outcome === 'conflict' ? 'text-warning' : 'text-secondary'}>
            {OUTCOME[c.outcome]}
            {c.outcome === 'conflict' && c.blockIds?.length
              ? ` · ${c.blockIds.length} paragraph${c.blockIds.length === 1 ? '' : 's'}`
              : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}
