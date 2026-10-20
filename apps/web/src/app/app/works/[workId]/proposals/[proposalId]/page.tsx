import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { Chapter, ProposalDetail } from '@morrow/contracts'
import { ProposalView } from '@/components/proposals/proposal-view'
import { ApiError, currentUser, serverApi } from '@/lib/server-api'

type Params = { params: Promise<{ workId: string; proposalId: string }> }

async function load(workId: string, proposalId: string) {
  try {
    const p = await serverApi<ProposalDetail>(`/proposals/${proposalId}`)
    if (p.workId !== workId) notFound()
    return p
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound()
    throw e
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { workId, proposalId } = await params
  return { title: (await load(workId, proposalId)).title }
}

export default async function ProposalPage({ params }: Params) {
  const { workId, proposalId } = await params
  const [p, user] = await Promise.all([load(workId, proposalId), currentUser()])
  if (!user) redirect('/sign-in')
  let chapterNumber = 1
  if (p.chapter) {
    const chapter = await serverApi<Chapter>(`/chapters/${p.chapter.id}`).catch(() => null)
    if (chapter) {
      const siblings = await serverApi<{ items: Chapter[] }>(`/branches/${chapter.branchId}/chapters`).catch(
        () => ({ items: [] }),
      )
      chapterNumber = Math.max(1, siblings.items.findIndex((c) => c.id === chapter.id) + 1)
    }
  }
  return (
    <ProposalView
      initial={p}
      chapterNumber={chapterNumber}
      collabUrl={process.env.COLLAB_PUBLIC_URL ?? 'ws://localhost:4001'}
      user={{ id: user.id, name: user.name }}
    />
  )
}
