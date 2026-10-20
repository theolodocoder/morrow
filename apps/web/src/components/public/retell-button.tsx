'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BranchIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'
import { api, ClientApiError } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { SignupPrompt } from './signup-wall'

/**
 * Write a retelling (P-063): the classic becomes a private work of your own (every chapter, ready to rewrite,
 * continue, modernise or answer back). Public domain, so it's yours to take anywhere.
 */
export function RetellButton({ publicPath }: { publicPath: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [join, setJoin] = useState(false)
  async function retell() {
    setBusy(true)
    try {
      const { id } = await api<{ id: string }>('/works/retell', { method: 'POST', body: { publicPath } })
      toast('Your copy is ready. It’s private until you publish it.')
      router.push(routes.work(id))
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 401) setJoin(true)
      else toast(e instanceof ClientApiError ? (e.problem.detail ?? e.message) : 'That didn’t work.')
      setBusy(false)
    }
  }
  return (
    <>
      <Button size="lg" variant="secondary" className="h-11" isDisabled={busy} onPress={() => void retell()}>
        <BranchIcon size={17} />
        {busy ? 'Copying…' : 'Write a retelling'}
      </Button>
      <SignupPrompt isOpen={join} onClose={() => setJoin(false)} action="write a retelling" />
    </>
  )
}
