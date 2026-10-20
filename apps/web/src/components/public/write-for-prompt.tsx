'use client'
import Link from 'next/link'
import { PenIcon } from '@/components/ui/icons'

const cls =
  'press inline-flex h-9 w-fit items-center gap-2 rounded-full bg-action px-4 text-sm font-medium text-action-fg outline-none hover:bg-action-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/** Opens the shell's Write sheet for this prompt; signed out, it's the way to join first. */
export function WriteForPrompt({ title, tag, signedIn }: { title: string; tag: string; signedIn: boolean }) {
  if (!signedIn)
    return (
      <Link href="/sign-up" className={cls}>
        <PenIcon size={15} />
        Join to write for it
      </Link>
    )
  return (
    <button
      type="button"
      className={cls}
      onClick={() => window.dispatchEvent(new CustomEvent('morrow:write', { detail: { title, tag } }))}
    >
      <PenIcon size={15} />
      Write for this prompt
    </button>
  )
}
