import { notFound, redirect } from 'next/navigation'
import type { Chapter } from '@morrow/contracts'
import { ApiError, serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'

export default async function WorkPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params
  const chapters = await serverApi<{ items: Chapter[] }>(`/works/${workId}/chapters`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound()
    throw e
  })
  const first = chapters.items[0]
  if (!first) notFound()
  redirect(routes.chapter(workId, first.id))
}
