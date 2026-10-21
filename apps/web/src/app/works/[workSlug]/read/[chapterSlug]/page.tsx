import type { Metadata } from 'next'
import type { PublicChapter, PublicWork } from '@morrow/contracts'
import { sectionLabel } from '@morrow/domain'
import { RichText } from '@/components/reader/rich-text'
import { ChapterOpener } from '@/components/reader/chapter-opener'
import { ReadingProgress } from '@/components/reader/reading-progress'
import { SuggestButton } from '@/components/proposals/suggest-button'
import { ParagraphComments } from '@/components/reader/paragraph-comments'
import { PollCard } from '@/components/reader/poll-card'
import { publicApi, publicApiAsViewer } from '@/lib/public-api'
import { ViewPing } from '@/components/reader/view-ping'
import { routes } from '@/lib/routes'
import { ReaderFrame } from '@/components/reader/reader-frame'
import { ChapterEnd } from '@/components/reader/chapter-end'
import { ChapterDiscussion } from '@/components/reader/chapter-discussion'
import type { CommentList } from '@/components/public/reader-comments'

type Params = { params: Promise<{ workSlug: string; chapterSlug: string }> }

async function load(params: Params['params']) {
  const { workSlug, chapterSlug } = await params
  const path = encodeURIComponent(workSlug)
  const [work, chapter] = await Promise.all([
    publicApi<PublicWork>(`/works/${path}`),
    // As the reader: signed-in readers get the whole chapter, signed-out readers the opening (P-044).
    publicApiAsViewer<PublicChapter>(`/works/${path}/chapters/${encodeURIComponent(chapterSlug)}`),
  ])
  return { work, chapter }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { work, chapter } = await load(params)
  return {
    title: `${chapter.title} — ${work.title}`,
    robots: work.indexable ? undefined : { index: false, follow: false },
    alternates: { canonical: routes.readChapter(work.publicPath, chapter.slug) },
  }
}

export default async function ReadChapterPage({ params }: Params) {
  const { workSlug, chapterSlug } = await params
  const [{ work, chapter }, discussion] = await Promise.all([
    load(params),
    // The first page as the viewer (their delete and reply rights), and its total for the reactions row's count.
    // Without it the discussion loads itself in the browser and the row reads "Comments".
    publicApiAsViewer<CommentList>(
      `/reading/${encodeURIComponent(workSlug)}/comments?chapter=${encodeURIComponent(chapterSlug)}`,
    ).catch(() => null),
  ])
  const label = sectionLabel(work.category, chapter.index, work.chapters.length)
  return (
    <ReaderFrame
      publicPath={work.publicPath}
      workTitle={work.title}
      chapterIndex={chapter.index}
      chapters={work.chapters}
      wordCount={chapter.wordCount}
      prevHref={chapter.prev ? routes.readChapter(work.publicPath, chapter.prev.slug) : null}
      nextHref={chapter.next ? routes.readChapter(work.publicPath, chapter.next.slug) : null}
    >
      <ReadingProgress publicPath={work.publicPath} chapterSlug={chapter.slug} />
      <main id="main" className="manuscript mx-auto max-w-[calc(65ch+2rem)] px-4 pb-16">
        <ChapterOpener label={label} title={chapter.title} credit={chapter.credit} />
        {chapter.index === 0 && work.contentWarnings.length > 0 && (
          <p className="mb-10 rounded-sm border border-subtle bg-app px-3 py-2 font-ui text-[13px] text-secondary">
            <span className="font-medium text-primary">Content notes:</span> {work.contentWarnings.join(', ')}
          </p>
        )}
        <article>
          <RichText doc={chapter.content} className="reading-body" form={work.category} dropCap />
        </article>
        <ViewPing publicPath={work.publicPath} />
        <ParagraphComments publicPath={work.publicPath} chapterSlug={chapter.slug} />
        <ChapterEnd work={work} chapter={chapter} label={label} comments={discussion?.total} />
        <PollCard publicPath={work.publicPath} chapterSlug={chapter.slug} />
        <ChapterDiscussion
          publicPath={work.publicPath}
          chapterSlug={chapter.slug}
          label={label}
          title={chapter.title}
          initial={discussion}
        />
        {work.openToSuggestions && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 font-ui">
            <p className="text-[13px] text-secondary">{work.author.displayName} welcomes suggestions.</p>
            <SuggestButton
              publicPath={work.publicPath}
              chapterSlug={chapter.slug}
              chapterTitle={chapter.title}
            />
          </div>
        )}
      </main>
    </ReaderFrame>
  )
}
