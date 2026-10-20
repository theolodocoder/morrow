import { notFound, redirect } from 'next/navigation'
import type { Chapter } from '@morrow/contracts'
import { ApiError, serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'

/** Opening a branch lands on its first chapter. */
export default async function BranchPage({
  params,
}: {
  params: Promise<{ workId: string; branchId: string }>
}) {
  const { workId, branchId } = await params
  const chapters = await serverApi<{ items: Chapter[] }>(`/branches/${branchId}/chapters`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound()
    throw e
  })
  const first = chapters.items[0]
  if (!first || first.workId !== workId) notFound()
  redirect(routes.chapter(workId, first.id))
}
