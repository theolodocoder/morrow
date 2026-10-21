import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { Branch, Chapter, Work } from '@morrow/contracts'
import { ApiError, currentUser, serverApi } from '@/lib/server-api'
import { EditorShell } from '@/components/editor/editor-shell'

type Params = { params: Promise<{ workId: string; chapterId: string }> }

/** A chapter belongs to exactly one branch; load that branch's context (architecture §10). */
async function load(workId: string, chapterId: string) {
  try {
    const [work, chapter, branches] = await Promise.all([
      serverApi<Work>(`/works/${workId}`),
      serverApi<Chapter>(`/chapters/${chapterId}`),
      serverApi<{ items: Branch[] }>(`/works/${workId}/branches`),
    ])
    if (chapter.workId !== work.id) notFound()
    const branch = branches.items.find((b) => b.id === chapter.branchId)
    if (!branch) notFound()
    const chapters = await serverApi<{ items: Chapter[] }>(`/branches/${branch.id}/chapters`)
    return { work, chapter, branch, branches: branches.items, chapters: chapters.items }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound()
    throw e
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { workId, chapterId } = await params
  const { work, branch } = await load(workId, chapterId)
  return { title: branch.isDefault ? work.title : `${work.title} · ${branch.name}` }
}

export default async function ChapterPage({ params }: Params) {
  const { workId, chapterId } = await params
  const { work, chapter, branch, branches, chapters } = await load(workId, chapterId)
  const user = await currentUser()
  if (!user) redirect('/sign-in')
  return (
    <EditorShell
      work={work}
      branch={branch}
      branches={branches}
      chapters={chapters}
      chapter={chapter}
      collabUrl={process.env.COLLAB_PUBLIC_URL ?? 'ws://localhost:4001'}
      user={{ id: user.id, name: user.name, avatarSeed: user.avatarSeed, avatar: user.avatar }}
    />
  )
}
