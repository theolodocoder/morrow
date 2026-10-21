'use client'
import { CommentThread, type CommentList } from '@/components/public/reader-comments'
import { MarginCommentsSwitch } from './reader-frame'

/**
 * A chapter's discussion (spec "Discussion"), after the chapter end: what readers said about this chapter, including
 * comments made on one of its paragraphs (quoting the line). It lives only here, so a reader meets it after reading
 * the chapter (call 4). The footer switch is the same preference as Aa's "Comments in the margin".
 */
export function ChapterDiscussion({
  publicPath,
  chapterSlug,
  label,
  title,
  initial,
}: {
  publicPath: string
  chapterSlug: string
  /** this chapter's section label ("Chapter three"); null for a single-piece work, which is named by its title */
  label: string | null
  title: string
  initial: CommentList | null
}) {
  const name = label ? label.toLowerCase() : `“${title}”`
  return (
    <section id="discussion" aria-labelledby="discussion-heading" className="mt-12 scroll-mt-20 font-ui">
      <CommentThread
        publicPath={publicPath}
        anchor={{ chapterSlug }}
        initial={initial}
        label={`Talk about ${name}`}
        placeholder="Share a thought…"
        empty="Nobody has talked about this yet. Say what stayed with you."
        heading={() => (
          <h2 id="discussion-heading" className="font-display text-[26px] text-primary">
            Talk about {name}
          </h2>
        )}
      />
      <div className="mt-6 border-t border-subtle pt-4">
        <MarginCommentsSwitch label="Show comments next to paragraphs while reading" />
      </div>
    </section>
  )
}
