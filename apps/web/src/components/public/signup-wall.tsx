'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Logo } from '@/components/brand/logo'
import { CloseIcon } from '@/components/ui/icons'

const signUpHref = (next: string) => `/sign-up?next=${encodeURIComponent(next)}`
const signInHref = (next: string) => `/sign-in?next=${encodeURIComponent(next)}`

function WallBody({
  title,
  body,
  next,
  onClose,
}: {
  title: string
  body: string
  next: string
  onClose?: () => void
}) {
  return (
    <Dialog className="relative flex flex-col items-center gap-4 text-center outline-none">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Not now"
          className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-sm text-secondary outline-none hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-focus"
        >
          <CloseIcon size={18} />
        </button>
      )}
      <Logo height={24} />
      <Heading slot="title" className="font-display text-[28px] leading-tight text-primary">
        {title}
      </Heading>
      <p className="max-w-[40ch] text-[15px] text-secondary">{body}</p>
      <div className="mt-1 flex w-full max-w-xs flex-col gap-2">
        <Link
          href={signUpHref(next)}
          className="inline-flex h-10 items-center justify-center rounded-full bg-action px-5 font-medium text-action-fg outline-none hover:bg-action-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          Create a free account
        </Link>
        <Link
          href={signInHref(next)}
          className="inline-flex h-10 items-center justify-center rounded-full border border-control px-5 text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
        >
          I have an account
        </Link>
      </div>
      <p className="text-[12px] text-tertiary">Free forever for reading, writing and collaborating.</p>
    </Dialog>
  )
}

/**
 * An invitation to join when a visitor tries to take part: like, follow, comment or contribute (P-049). Reading never
 * needs an account, so this is always dismissable.
 */
export function SignupPrompt({
  isOpen,
  onClose,
  action,
}: {
  isOpen: boolean
  onClose: () => void
  action: string
}) {
  const next = usePathname()
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      isDismissable
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(25_26_24/.35)] sm:items-center"
    >
      <Modal className="w-full max-w-md rounded-t-xl border border-subtle bg-raised px-6 pb-8 pt-7 sm:rounded-xl">
        <WallBody
          title={`Join Morrow to ${action}`}
          body="Follow writers you love, like and discuss their work, and write your own: alone or together."
          next={next}
          onClose={onClose}
        />
      </Modal>
    </ModalOverlay>
  )
}
