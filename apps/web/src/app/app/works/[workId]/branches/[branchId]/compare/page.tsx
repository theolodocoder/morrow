import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { BranchCompare, Chapter } from '@morrow/contracts'
import type { BlockChange } from '@morrow/editor'
import { DiffView } from '@/components/diff/diff-view'
import { MergePanel } from '@/components/editor/merge-panel'
import { ArrowLeftIcon, BranchIcon, ChevronDownIcon } from '@/components/ui/icons'
import { ApiError, serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'

export const metadata = { title: 'Compare versions' }
type Params = {
  params: Promise<{ workId: string; branchId: string }>
  searchParams: Promise<{ with?: string }>
}

const STATUS = {
  same: 'Same',
  changed: 'Changed',
  only_here: 'Only in this branch',
  only_there: 'Only in',
} as const
const count = (s: { changed: number; added: number; removed: number }) =>
  [s.changed && `${s.changed} changed`, s.added && `${s.added} added`, s.removed && `${s.removed} removed`]
    .filter(Boolean)
    .join(' · ')

const TONE = {
  same: 'bg-app text-secondary',
  changed: 'bg-selected text-accent',
  only_here: 'bg-[color-mix(in_srgb,var(--text-success)_14%,transparent)] text-success',
  only_there: 'bg-[color-mix(in_srgb,var(--text-warning)_14%,transparent)] text-warning',
} as const

/** The two versions as the logo's forking line: where they split, and the names at the ends. */
function Fork({ branch, other }: { branch: string; other: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 260 80" className="h-auto w-full max-w-[300px] text-accent">
      <path
        d="M10 56h70c26 0 30-34 60-34h40"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="spot-write"
      />
      <path
        d="M80 56h100"
        fill="none"
        stroke="var(--text-tertiary)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="56" r="4" fill="var(--text-tertiary)" />
      <circle cx="180" cy="22" r="5" fill="currentColor" />
      <circle cx="180" cy="56" r="5" fill="var(--text-tertiary)" />
      <text
        x="192"
        y="26"
        fontSize="12"
        fill="var(--text-primary)"
        fontFamily="var(--font-ui-family, sans-serif)"
      >
        {branch.length > 10 ? `${branch.slice(0, 9)}…` : branch}
      </text>
      <text
        x="192"
        y="60"
        fontSize="12"
        fill="var(--text-secondary)"
        fontFamily="var(--font-ui-family, sans-serif)"
      >
        {other.length > 10 ? `${other.slice(0, 9)}…` : other}
      </text>
    </svg>
  )
}

/** FR-018: compare a branch with another version (its parent by default), chapter by chapter, and merge it. */
export default async function BranchComparePage({ params, searchParams }: Params) {
  const { workId, branchId } = await params
  const other = (await searchParams).with
  const cmp = await serverApi<BranchCompare>(
    `/branches/${branchId}/compare${other ? `?with=${encodeURIComponent(other)}` : ''}`,
  ).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) notFound()
    throw e
  })
  const otherChapters = await serverApi<{ items: Chapter[] }>(`/branches/${cmp.other.id}/chapters`).catch(
    () => ({ items: [] as Chapter[] }),
  )
  const differing = cmp.chapters.filter((c) => c.status !== 'same')
  const totals = cmp.chapters.reduce(
    (t, c) => ({
      changed: t.changed + (c.status === 'changed' ? c.summary.changed : 0),
      added: t.added + (c.status === 'changed' ? c.summary.added : 0),
      removed: t.removed + (c.status === 'changed' ? c.summary.removed : 0),
    }),
    { changed: 0, added: 0, removed: 0 },
  )
  return (
    <div className="min-h-dvh bg-app">
      <header className="flex h-12 items-center gap-3 border-b border-subtle bg-canvas px-2">
        <Link
          href={routes.branch(workId, branchId)}
          className="press inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-secondary hover:bg-hover hover:text-primary"
        >
          <ArrowLeftIcon size={18} />
          {cmp.branch.name}
        </Link>
      </header>
      <main id="main" className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Fork branch={cmp.branch.name} other={cmp.other.name} />
          <p className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
            <BranchIcon size={14} />
            Compare versions
          </p>
          <h1 className="mt-2 font-display text-[32px] leading-tight sm:text-[40px]">
            “{cmp.branch.name}” <span className="text-secondary">and</span> {cmp.other.name}
          </h1>
          <p className="mt-2 text-secondary">
            {differing.length === 0
              ? `This branch reads the same as ${cmp.other.name}.`
              : `What this branch does differently, chapter by chapter: ${differing.length} of ${cmp.chapters.length} differ.`}
          </p>
          {differing.length > 0 && (
            <ul aria-label="All changes" className="mt-4 flex flex-wrap gap-2 text-[12px]">
              {(
                [
                  ['changed', totals.changed, 'paragraphs changed'],
                  ['added', totals.added, 'added'],
                  ['removed', totals.removed, 'removed'],
                ] as const
              )
                .filter(([, n]) => n > 0)
                .map(([k, n, l]) => (
                  <li
                    key={k}
                    className={`rounded-full px-2.5 py-1 ${k === 'added' ? TONE.only_here : k === 'removed' ? TONE.only_there : TONE.changed}`}
                  >
                    <span className="font-semibold">{n}</span> {l}
                  </li>
                ))}
            </ul>
          )}
          <ol className="mt-8 flex flex-col gap-3">
            {cmp.chapters.map((c, i) => (
              <li
                key={`${c.chapterId ?? c.otherChapterId}-${i}`}
                className="overflow-hidden rounded-lg border border-subtle bg-canvas transition-shadow hover:shadow-sm"
              >
                <details open={c.status === 'changed' && differing.length <= 3} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="w-6 shrink-0 font-mono text-[12px] text-tertiary">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-primary">
                      {c.title}
                      {c.otherTitle && c.otherTitle !== c.title && (
                        <span className="font-normal text-secondary">
                          {' '}
                          (in {cmp.other.name}: {c.otherTitle})
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] ${TONE[c.status]}`}>
                      {c.status === 'only_there'
                        ? `${STATUS.only_there} ${cmp.other.name}`
                        : STATUS[c.status]}
                      {c.status === 'changed' && count(c.summary) ? ` · ${count(c.summary)}` : ''}
                    </span>
                    {c.status !== 'same' && (
                      <ChevronDownIcon
                        size={16}
                        className="shrink-0 text-tertiary transition-transform duration-200 group-open:rotate-180"
                      />
                    )}
                  </summary>
                  {c.status !== 'same' && (
                    <div className="border-t border-subtle px-4 py-5">
                      {c.status === 'only_there' ? (
                        <p className="text-[13px] text-secondary">
                          This chapter is in {cmp.other.name} but not in this branch. Merging never deletes
                          it.
                        </p>
                      ) : (
                        <DiffView changes={c.changes as BlockChange[]} />
                      )}
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ol>
        </div>
        <aside className="lg:pt-16">
          <MergePanel
            workId={workId}
            branchId={cmp.branch.id}
            branchName={cmp.branch.name}
            parentName={cmp.other.name}
            canMerge={cmp.canMerge}
            mainChapterHref={
              otherChapters.items[0] ? routes.chapter(workId, otherChapters.items[0].id) : routes.work(workId)
            }
          />
        </aside>
      </main>
    </div>
  )
}
