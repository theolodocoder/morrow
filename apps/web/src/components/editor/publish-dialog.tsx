'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AlternateStatus, Branch, Chapter, PublicationStatus, PublicWork, Work } from '@morrow/contracts'
import { Checkbox } from 'react-aria-components'
import { Button } from '@/components/ui/button'
import { ChoiceGroup, SelectField } from '@/components/ui/choice'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { toast } from '@/components/ui/toast'
import { api, ClientApiError } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { VISIBILITY_OPTIONS } from '@/lib/work-options'

type Audience = 'public' | 'unlisted'
const AUDIENCES = VISIBILITY_OPTIONS.filter((o) => o.id !== 'private') as {
  id: Audience
  label: string
  description?: string
}[]

/**
 * Publish (PRD FR-023, Journey A). Publishing is a deliberate act with a stated consequence: readers get a frozen copy
 * of the chosen version as it is now; drafting continues privately until the next publish.
 */
export function PublishDialog({
  work,
  isOpen,
  onOpenChange,
}: {
  work: Work
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<PublicationStatus | null>(null)
  const [audience, setAudience] = useState<Audience>(work.visibility === 'unlisted' ? 'unlisted' : 'public')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [completed, setCompleted] = useState(work.completed)

  /** Readers see "Complete" or "Ongoing"; finishing also earns The Finisher badge. */
  const markComplete = async (on: boolean) => {
    setCompleted(on)
    try {
      await api(`/works/${work.id}`, { method: 'PATCH', body: { completed: on } })
      router.refresh()
    } catch (e) {
      setCompleted(!on)
      setError(e instanceof Error ? e.message : 'That didn’t save.')
    }
  }

  useEffect(() => {
    if (!isOpen) return
    setConfirming(false)
    setError(null)
    setCopied(false)
    void api<PublicationStatus>(`/works/${work.id}/publication`)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [isOpen, work.id])

  const run = async (path: 'publish' | 'unpublish') => {
    setBusy(true)
    setError(null)
    try {
      setStatus(
        await api<PublicationStatus>(`/works/${work.id}/${path}`, {
          method: 'POST',
          body: path === 'publish' ? { visibility: audience } : {},
        }),
      )
      setConfirming(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  const url =
    status && typeof window !== 'undefined'
      ? `${window.location.origin}${routes.publicWork(status.publicPath)}`
      : ''
  const live = status?.published && status.visibility !== 'private'

  return (
    <Dialog
      title={live ? 'Published' : `Publish “${work.title}”`}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {/* the shared dialog doesn't scroll, and the versions list can outgrow a short window */}
      <div className="-mx-1 flex max-h-[calc(100dvh-9rem)] flex-col gap-5 overflow-y-auto px-1">
        {error && <InlineAlert>{error}</InlineAlert>}

        {live && (
          <div className="rounded-sm border border-subtle bg-app p-3" role="status">
            <p className="text-sm text-primary">
              {status.visibility === 'public' ? 'Anyone can read' : 'Anyone with the link can read'}{' '}
              {status.chapterCount === 1 ? '1 chapter' : `${status.chapterCount} chapters`}
              {status.branchName ? ` from the “${status.branchName}” version` : ''}.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                value={url}
                aria-label="Public link"
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-sm border border-control bg-canvas px-2 font-mono text-[12px] text-primary"
              />
              <Button
                size="md"
                variant="secondary"
                onPress={async () => {
                  await navigator.clipboard.writeText(url)
                  setCopied(true)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <a
              href={status ? routes.publicWork(status.publicPath) : '#'}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[13px] text-accent underline underline-offset-2"
            >
              Open the reading page
            </a>
            <Checkbox
              isSelected={completed}
              onChange={(v) => void markComplete(v)}
              className="group mt-3 flex cursor-default items-start gap-2.5 border-t border-subtle pt-3 text-sm text-primary outline-none"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border border-control group-data-[selected]:border-action group-data-[selected]:bg-action group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-focus"
              >
                <svg viewBox="0 0 12 12" className="hidden size-3 text-action-fg group-data-[selected]:block">
                  <path
                    d="M2.5 6.5l2.2 2.2 4.8-5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span>
                This work is complete
                <span className="block text-[13px] text-secondary">
                  Readers see “Complete” instead of “Ongoing”. You can still publish changes.
                </span>
              </span>
            </Checkbox>
          </div>
        )}

        {live && work.capabilities.includes('work.publish') && (
          <AlternateVersions
            workId={work.id}
            publicPath={status.publicPath}
            mainBranchName={status.branchName}
            publishedAt={status.publishedAt}
          />
        )}

        {!confirming ? (
          <>
            <ChoiceGroup
              label="Who can read it"
              value={audience}
              onChange={setAudience}
              options={AUDIENCES}
            />
            <p className="text-[13px] text-secondary">
              Readers get a copy of every chapter as it is right now. What you write afterwards stays private
              until you publish again.
              {work.contentWarnings.length === 0
                ? ' Consider adding content warnings in Work settings first.'
                : ''}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {live && (
                <Button variant="quiet" isDisabled={busy} onPress={() => void run('unpublish')}>
                  Unpublish
                </Button>
              )}
              <Button variant="quiet" onPress={() => onOpenChange(false)}>
                {live ? 'Done' : 'Cancel'}
              </Button>
              <Button variant="primary" onPress={() => setConfirming(true)}>
                {live ? 'Publish latest' : 'Continue'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-primary">
              {audience === 'public'
                ? 'Anyone will be able to find and read'
                : 'Anyone with the link will be able to read'}{' '}
              “{work.title}” as it is now. You can unpublish at any time.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" isDisabled={busy} onPress={() => setConfirming(false)}>
                Back
              </Button>
              <Button variant="primary" isDisabled={busy} onPress={() => void run('publish')}>
                {busy ? 'Publishing…' : audience === 'public' ? 'Publish publicly' : 'Publish to link'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

/**
 * Alternate versions (reading-experience spec, owner decisions): the owner offers a branch beside the main story.
 * The API judges eligibility; here we only explain what is already knowable from the branch list, and show the
 * server's own words when it refuses.
 */
type VersionRow = { alt: AlternateStatus; branch: Branch }

function AlternateVersions({
  workId,
  publicPath,
  mainBranchName,
  publishedAt,
}: {
  workId: string
  publicPath: string
  mainBranchName: string | null
  /** changes when main is republished, which changes what a version can start from */
  publishedAt: string | null
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [startChapters, setStartChapters] = useState<Chapter[]>([])
  const [mainId, setMainId] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setFailed(false)
    void (async () => {
      try {
        const [{ items: alts }, { items: branches }, live] = await Promise.all([
          api<{ items: AlternateStatus[] }>(`/works/${workId}/alternates`),
          api<{ items: Branch[] }>(`/works/${workId}/branches`),
          api<PublicWork>(`/public/works/${publicPath}`),
        ])
        // Which branch readers get as main. A null name means the default branch (the publish response omits it);
        // otherwise only an unambiguous name identifies it.
        const named = branches.filter((b) => b.name === mainBranchName)
        const main =
          mainBranchName === null
            ? branches.find((b) => b.isDefault)
            : named.length === 1
              ? named[0]
              : undefined
        const draft = main ? (await api<{ items: Chapter[] }>(`/branches/${main.id}/chapters`)).items : []
        // A version may only start from a chapter in main's live publication, after its first. Slugs end with the
        // last six characters of the chapter id, which links the published rows back to the draft ones.
        const starts = live.chapters.slice(1).flatMap((p) => {
          const c = draft.find((d) => d.id.endsWith(p.slug.slice(-6)))
          return c ? [c] : []
        })
        if (stale) return
        setMainId(main?.id ?? null)
        setStartChapters(starts)
        setRows(
          alts.flatMap((alt) => {
            const branch = branches.find((b) => b.id === alt.branchId)
            return branch ? [{ alt, branch }] : []
          }),
        )
      } catch {
        if (!stale) setFailed(true)
      }
    })()
    return () => {
      stale = true
    }
  }, [workId, publicPath, mainBranchName, publishedAt])

  const act = async ({ alt, branch }: VersionRow) => {
    const unpublish = alt.published
    setBusyId(alt.branchId)
    setError(null)
    try {
      const next = await api<AlternateStatus>(
        `/works/${workId}/branches/${alt.branchId}/${unpublish ? 'unpublish' : 'publish'}-alternate`,
        {
          method: 'POST',
          body:
            !unpublish && !branch.divergesAtChapterTitle ? { divergesAtChapterId: pick[alt.branchId] } : {},
        },
      )
      // the server records the owner's pick as the branch's divergence, so republishing asks nothing more
      const picked = startChapters.find((c) => c.id === pick[alt.branchId])?.title ?? null
      setRows(
        (rs) =>
          rs?.map((r) =>
            r.alt.branchId === alt.branchId
              ? {
                  alt: next,
                  branch: { ...r.branch, divergesAtChapterTitle: r.branch.divergesAtChapterTitle ?? picked },
                }
              : r,
          ) ?? rs,
      )
      toast(unpublish ? 'Version unpublished.' : 'Version published.')
    } catch (e) {
      setError(
        e instanceof ClientApiError
          ? (e.problem.detail ?? e.message)
          : e instanceof Error
            ? e.message
            : 'That didn’t work.',
      )
    } finally {
      setBusyId(null)
    }
  }

  if (!failed && !rows?.length) return null

  return (
    <section aria-labelledby="alt-versions" className="flex flex-col gap-2 border-t border-subtle pt-4">
      <h3 id="alt-versions" className="text-sm font-medium text-primary">
        Alternate versions
      </h3>
      <p className="text-[13px] text-secondary">
        Readers can choose a version at the end of the chapter before it differs. It sits beside the main
        story, never instead of it.
      </p>
      {(failed || error) && (
        <InlineAlert>
          {failed ? 'Couldn’t load your versions. Close this and open it again to retry.' : error}
        </InlineAlert>
      )}
      <ul className="flex flex-col gap-2">
        {(rows ?? []).map((r) => {
          const { alt, branch } = r
          const unseen = !alt.published && mainId !== null && branch.parentBranchId !== mainId
          const needsPick = !alt.published && !unseen && !branch.divergesAtChapterTitle
          return (
            <li key={alt.branchId} className="flex flex-col gap-2 rounded-sm border border-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">{alt.name}</p>
                  {branch.description && <p className="text-[13px] text-secondary">{branch.description}</p>}
                  <p className="text-[12px] text-tertiary">
                    {alt.published
                      ? `Published · ${alt.chapterCount === 1 ? '1 chapter' : `${alt.chapterCount} chapters`}`
                      : unseen
                        ? 'Starts from a version readers can’t see yet'
                        : branch.divergesAtChapterTitle
                          ? `Differs from ${branch.divergesAtChapterTitle}`
                          : 'Not published'}
                  </p>
                </div>
                {(alt.published || !unseen) && (
                  <Button
                    size="sm"
                    variant={alt.published ? 'quiet' : 'secondary'}
                    isDisabled={busyId !== null || (needsPick && !pick[alt.branchId])}
                    aria-describedby={
                      needsPick && !pick[alt.branchId] ? `alt-hint-${alt.branchId}` : undefined
                    }
                    onPress={() => void act(r)}
                  >
                    {alt.published ? 'Unpublish' : 'Publish version'}
                  </Button>
                )}
              </div>
              {needsPick && (
                <>
                  {startChapters.length > 0 && (
                    <SelectField
                      label={`First chapter of “${alt.name}” that differs from the main story`}
                      value={pick[alt.branchId] ?? ''}
                      onChange={(v) => setPick((p) => ({ ...p, [alt.branchId]: v }))}
                      options={startChapters.map((c) => ({ id: c.id, label: c.title }))}
                    />
                  )}
                  {!pick[alt.branchId] && (
                    <p id={`alt-hint-${alt.branchId}`} className="text-[12px] text-tertiary">
                      {startChapters.length > 0
                        ? 'Choose where this version differs to publish it.'
                        : 'The main story needs a second published chapter before a version can branch from it.'}
                    </p>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
