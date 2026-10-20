'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  ArrowLeftIcon,
  BranchIcon,
  ChaptersIcon,
  DownloadIcon,
  FeedbackIcon,
  FocusIcon,
  HistoryIcon,
  InboxIcon,
  MoreIcon,
  ProposeIcon,
  ImageIcon,
  SettingsIcon,
  ShareIcon,
} from '@/components/ui/icons'
import { useFeedbackUnread } from './use-feedback-unread'
import { FeedbackDialog } from '@/components/feedback-dialog'
import { useEffect, useState } from 'react'
import type { Branch, Chapter, Work } from '@morrow/contracts'
import { BranchSwitcher } from './branch-switcher'
import { WorkSettingsDialog } from './work-settings-dialog'
import { CoverDialog } from './cover-dialog'
import { PollDialog } from './poll-dialog'
import { PublishDialog } from './publish-dialog'
import { ProposeDialog } from '@/components/proposals/propose-dialog'
import { ActionMenu } from '@/components/ui/menu'
import { Button } from '@/components/ui/button'
import { ChapterNavigator } from './chapter-navigator'
import { ConnectionStatus } from './connection-status'
import { GoalRing } from './goal-ring'
import { ManuscriptCanvas } from './manuscript-canvas'
import { VersionHistory } from './version-history'
import { useCollab } from './use-collab'
import { PresenceStack } from './presence-stack'
import { VoiceControl } from './voice-control'
import { ShareDialog } from './share-dialog'
import { FeedbackPanel } from './feedback-panel'
import { EditorPanel } from './editor-panel'
import type { CanvasFeedback, CommentDraft } from './manuscript-canvas'
import type { Editor } from '@tiptap/react'
import { api } from '@/lib/client-api'
import { presenceColor, type PresenceUser } from '@/lib/presence'
import { useCallback, useMemo } from 'react'
import { routes } from '@/lib/routes'

/** Editor layout (design system §10): quiet top bar, optional navigator, the canvas, an optional panel. */
export function EditorShell({
  work,
  branch,
  branches,
  chapters,
  chapter,
  collabUrl,
  user,
}: {
  work: Work
  branch: Branch
  branches: Branch[]
  chapters: Chapter[]
  chapter: Chapter
  collabUrl: string
  user: { id: string; name: string }
}) {
  const me: PresenceUser = useMemo(
    () => ({ id: user.id, name: user.name, color: presenceColor(user.id, work.id) }),
    [user.id, user.name, work.id],
  )
  const collab = useCollab(chapter.documentId, collabUrl, me)
  const router = useRouter()
  const [shareOpen, setShareOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [coverOpen, setCoverOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [proposeOpen, setProposeOpen] = useState(false)
  const [betaFeedbackOpen, setBetaFeedbackOpen] = useState(false)
  // Pinned on wide screens; a drawer on small ones, closed by default (design system §15).
  const [navOpen, setNavOpen] = useState(true)
  useEffect(() => {
    if (!window.matchMedia('(min-width: 768px)').matches) setNavOpen(false)
  }, [])
  const [historyOpen, setHistoryOpen] = useState(false)
  // Notifications about comments link here with ?feedback=1: open straight onto the conversation.
  const [feedbackOpen, setFeedbackOpen] = useState(useSearchParams().get('feedback') === '1')
  const [draft, setDraft] = useState<CommentDraft | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const onEditor = useCallback((e: Editor | null) => setEditor(e), [])
  const unread = useFeedbackUnread(chapter.documentId, collab, feedbackOpen)
  // Feedback (FR-016/017): who may comment or react comes from the server's capabilities, never the UI.
  const feedback: CanvasFeedback = useMemo(
    () => ({
      canComment: work.capabilities.includes('comment.create'),
      reactionKinds: work.capabilities.includes('reaction.create') ? work.reactionKinds : [],
      onComment: (d) => {
        setDraft(d)
        setHistoryOpen(false)
        setFeedbackOpen(true)
      },
      onReact: (blockId, kind) => {
        void api(`/documents/${chapter.documentId}/reactions`, { method: 'PUT', body: { blockId, kind } })
        setHistoryOpen(false)
        setFeedbackOpen(true)
      },
    }),
    [work.capabilities, work.reactionKinds, chapter.documentId],
  )
  const [focus, setFocus] = useState(false)
  // Writing in a branch needs branch.edit; on the main manuscript, document.edit.
  const canEdit = branch.capabilities.includes(branch.isDefault ? 'document.edit' : 'branch.edit')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === '\\') {
        e.preventDefault()
        setNavOpen((v) => !v)
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFocus((v) => !v)
      }
      if (e.key === 'Escape') setFocus(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const showNav = navOpen && !focus
  const closeFeedback = useCallback(() => setFeedbackOpen(false), [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  // Below `sm` the top bar can't hold every action at 320px (WCAG 1.4.10); the secondary ones move into ⋯.
  const narrow = useNarrow()

  return (
    <div className="flex h-dvh flex-col bg-app">
      <header
        // Off the main manuscript, a clay rule under the top bar says so at all times (design system §12).
        className={`flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:gap-2 sm:px-3 ${branch.isDefault ? 'border-subtle' : 'border-b-2 border-action'} transition-opacity duration-[var(--motion-base)] ${focus ? 'opacity-30 hover:opacity-100 focus-within:opacity-100' : ''}`}
      >
        <Link
          href={routes.library}
          aria-label="Back to your works"
          title="Back to your works"
          className="press grid size-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
        >
          <ArrowLeftIcon />
        </Link>
        <Button
          size="sm"
          variant="quiet"
          aria-pressed={showNav}
          aria-label="Chapters"
          className="px-2"
          onPress={() => setNavOpen(!navOpen)}
        >
          <ChaptersIcon />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{work.title}</p>
          <BranchSwitcher
            workId={work.id}
            branch={branch}
            branches={branches}
            chapters={chapters}
            canCreate={work.capabilities.includes('branch.create')}
          />
        </div>
        {collab?.synced && <PresenceStack provider={collab.provider} me={me} />}
        {collab?.synced && <VoiceControl collab={collab} me={me} />}
        {collab && <ConnectionStatus status={collab.status} />}
        {!collab?.readOnly && <GoalRing />}
        {/* Panels and sharing: icons (named for screen readers, titled on hover), as in every collaborative editor. */}
        <span className="hidden sm:contents">
          <HeaderButton
            icon={<HistoryIcon />}
            label="Versions"
            pressed={historyOpen}
            iconOnly
            onPress={() => {
              setHistoryOpen(!historyOpen)
              setFeedbackOpen(false)
            }}
          />
        </span>
        <HeaderButton
          icon={<FeedbackIcon />}
          label="Feedback"
          pressed={feedbackOpen}
          badge={unread}
          iconOnly
          onPress={() => {
            setFeedbackOpen(!feedbackOpen)
            setHistoryOpen(false)
          }}
        />
        <span className="hidden sm:contents">
          <HeaderButton
            icon={<ShareIcon />}
            label={work.capabilities.includes('work.manage_members') ? 'Share' : 'People'}
            iconOnly
            onPress={() => setShareOpen(true)}
          />
        </span>
        {/* The one primary action: publishing for the owner; proposing for whoever can't write here directly (FR-013). */}
        {work.capabilities.includes('work.publish') ? (
          <Button
            size="sm"
            variant={work.publishedAt ? 'secondary' : 'primary'}
            onPress={() => setPublishOpen(true)}
            className="press ml-1 rounded-full px-3.5"
          >
            {work.publishedAt ? 'Published' : 'Publish'}
          </Button>
        ) : (
          work.capabilities.includes('proposal.create') &&
          !canEdit && (
            <Button
              size="sm"
              variant="primary"
              onPress={() => setProposeOpen(true)}
              className="press ml-1 rounded-full px-3.5"
            >
              <ProposeIcon size={16} />
              Propose
            </Button>
          )
        )}
        <ActionMenu
          label="More actions"
          trigger={<MoreIcon />}
          actions={[
            ...(narrow
              ? [
                  {
                    id: 'share',
                    label: work.capabilities.includes('work.manage_members') ? 'Share' : 'People',
                    icon: <ShareIcon size={16} />,
                    onAction: () => setShareOpen(true),
                  },
                  {
                    id: 'versions',
                    label: 'Versions',
                    icon: <HistoryIcon size={16} />,
                    onAction: () => {
                      setHistoryOpen(true)
                      setFeedbackOpen(false)
                    },
                  },
                ]
              : []),
            // An owner or editor can still offer a change for review instead of writing it in.
            ...(work.capabilities.includes('proposal.create') && canEdit
              ? [
                  {
                    id: 'propose',
                    label: 'Propose a change…',
                    icon: <ProposeIcon size={16} />,
                    onAction: () => setProposeOpen(true),
                  },
                ]
              : []),
            {
              id: 'focus',
              label: focus ? 'Leave focus mode' : 'Focus mode',
              icon: <FocusIcon size={16} />,
              onAction: () => setFocus(!focus),
            },
            // FR-018: off Main, compare this branch with its parent and merge it.
            ...(branch.isDefault
              ? []
              : [
                  {
                    id: 'compare',
                    label: 'Compare & merge…',
                    icon: <BranchIcon size={16} />,
                    onAction: () => router.push(routes.branchCompare(work.id, branch.id)),
                  },
                ]),
            {
              id: 'proposals',
              label: 'Proposals',
              icon: <InboxIcon size={16} />,
              onAction: () => router.push(routes.proposals(work.id)),
            },
            ...(work.capabilities.includes('work.manage_settings')
              ? [
                  {
                    id: 'poll',
                    label: 'Ask readers (poll)…',
                    icon: <ProposeIcon size={16} />,
                    onAction: () => setPollOpen(true),
                  },
                  {
                    id: 'cover',
                    label: 'Cover…',
                    icon: <ImageIcon size={16} />,
                    onAction: () => setCoverOpen(true),
                  },
                  {
                    id: 'settings',
                    label: 'Work settings',
                    icon: <SettingsIcon size={16} />,
                    onAction: () => setSettingsOpen(true),
                  },
                ]
              : []),
            {
              id: 'beta-feedback',
              label: 'Send feedback to Morrow',
              onAction: () => setBetaFeedbackOpen(true),
            },
            {
              id: 'export',
              label: 'Download as Markdown',
              icon: <DownloadIcon size={16} />,
              onAction: () => {
                window.location.href = `/api/v1/branches/${branch.id}/export.md`
              },
            },
          ]}
        />
      </header>
      <div className="flex min-h-0 flex-1">
        {showNav && (
          <>
            <button
              type="button"
              aria-label="Close chapters"
              tabIndex={-1}
              onClick={() => setNavOpen(false)}
              className="fixed inset-0 top-12 z-20 bg-[rgb(25_26_24/.3)] md:hidden"
            />
            <aside className="fixed inset-y-0 left-0 top-12 z-30 w-[min(300px,85vw)] border-r border-subtle bg-sidebar md:static md:z-auto md:w-[264px] md:shrink-0">
              <ChapterNavigator
                workId={work.id}
                branchId={branch.id}
                canManage={work.capabilities.includes('work.manage_settings')}
                chapters={chapters}
                currentId={chapter.id}
                canEdit={canEdit}
              />
            </aside>
          </>
        )}
        <main id="main" className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          {/* Mount the editor only after the first sync: an editor bound to a not-yet-synced (empty) Y.Doc writes its
              own initial paragraph into the shared document, which then merges with the real content. */}
          {collab?.synced ? (
            <ManuscriptCanvas
              key={chapter.documentId}
              collab={collab}
              chapterTitle={chapter.title}
              me={me}
              chapterNumber={chapters.findIndex((c) => c.id === chapter.id) + 1}
              feedback={feedback}
              onEditor={onEditor}
              form={work.category}
            />
          ) : (
            <p className="mx-auto max-w-[68ch] px-5 pt-24 font-manuscript italic text-tertiary">
              {collab && (collab.status === 'denied' || collab.status === 'reload-required')
                ? ''
                : 'Opening chapter…'}
            </p>
          )}
        </main>
        {feedbackOpen && collab && (
          <EditorPanel label="Feedback" onClose={closeFeedback}>
            <FeedbackPanel
              workId={work.id}
              documentId={chapter.documentId}
              editor={editor}
              collab={collab}
              draft={draft}
              onDraftDone={() => setDraft(null)}
              meId={user.id}
            />
          </EditorPanel>
        )}
        {historyOpen && collab && (
          <EditorPanel label="Versions" onClose={closeHistory}>
            <VersionHistory
              documentId={chapter.documentId}
              canSave={canEdit && !collab.readOnly}
              onSnapshot={collab.onSnapshot}
            />
          </EditorPanel>
        )}
      </div>
      <WorkSettingsDialog work={work} isOpen={settingsOpen} onOpenChange={setSettingsOpen} />
      <PollDialog chapterId={chapter.id} isOpen={pollOpen} onOpenChange={setPollOpen} />
      <CoverDialog
        workId={work.id}
        title={work.title}
        cover={work.cover}
        isOpen={coverOpen}
        onOpenChange={setCoverOpen}
      />
      <PublishDialog work={work} isOpen={publishOpen} onOpenChange={setPublishOpen} />
      <FeedbackDialog isOpen={betaFeedbackOpen} onOpenChange={setBetaFeedbackOpen} />
      <ProposeDialog
        workId={work.id}
        chapter={{ id: chapter.id, title: chapter.title }}
        isOpen={proposeOpen}
        onOpenChange={setProposeOpen}
      />
      <ShareDialog
        workId={work.id}
        workTitle={work.title}
        canManage={work.capabilities.includes('work.manage_members')}
        meId={user.id}
        isOpen={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  )
}

/**
 * A top-bar action: icon plus label on wide screens, icon alone (still named) on narrow ones. `badge` shows that
 * something new is waiting: a pulsing dot (still under reduced motion), and the count in the accessible name.
 */
function HeaderButton({
  icon,
  label,
  short,
  onPress,
  pressed,
  primary,
  badge = 0,
  iconOnly,
}: {
  icon: ReactNode
  label: string
  short?: string
  onPress: () => void
  pressed?: boolean
  primary?: boolean
  badge?: number
  iconOnly?: boolean
}) {
  const name = badge > 0 ? `${label}, ${badge} new` : label
  return (
    <Button
      size="sm"
      variant={primary ? 'primary' : 'quiet'}
      aria-label={name}
      aria-pressed={pressed}
      onPress={onPress}
      // icon-only controls say what they are on hover, too
      {...(iconOnly ? { title: label } : {})}
      className={`press relative ${iconOnly ? 'size-9 rounded-full px-0' : 'px-2 lg:px-3'}`}
    >
      {icon}
      {!iconOnly && (
        <span aria-hidden="true" className="hidden lg:inline">
          {short ?? label}
        </span>
      )}
      {badge > 0 && (
        <span
          key={badge}
          aria-hidden="true"
          className="feedback-dot absolute right-1 top-1 size-2 rounded-full bg-action ring-2 ring-canvas"
        />
      )}
    </Button>
  )
}

/** True below the `sm` breakpoint (640px). Starts false so server and first client render agree. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639.98px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return narrow
}
