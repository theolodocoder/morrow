'use client'
import type { ReactNode } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { CloseIcon } from './icons'
import { useSwipeClose } from './use-swipe-close'

/**
 * A sheet: rises from the bottom on phones (with a grab handle, within thumb reach), and is a centred dialog on
 * larger screens. Focus is trapped and restored; Escape and the backdrop close it (React Aria),
 * and on touch screens so does a swipe down on the handle.
 */
export function Sheet({
  title,
  isOpen,
  onOpenChange,
  children,
  hideTitle = false,
}: {
  title: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  hideTitle?: boolean
}) {
  const swipe = useSwipeClose(() => onOpenChange(false))
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[rgb(25_26_24_/_0.35)] sm:items-center sm:p-4"
    >
      <Modal
        data-swipe-sheet
        className="sheet max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-subtle bg-raised px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_40px_rgb(34_34_31/.18)] sm:max-w-lg sm:rounded-xl sm:p-6"
      >
        <AriaDialog className="outline-none">
          {({ close }) => (
            <>
              {/* the grab handle: drag it down to close (phones) */}
              <div aria-hidden="true" {...swipe} className="-mx-5 -mt-3 mb-1 pb-2 pt-3 sm:hidden">
                <div className="mx-auto h-1 w-10 rounded-full bg-[var(--border-control)]" />
              </div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <Heading
                  slot="title"
                  className={hideTitle ? 'sr-only' : 'text-lg font-semibold text-primary'}
                >
                  {title}
                </Heading>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="-mr-2 hidden size-8 place-items-center rounded-sm text-secondary outline-none hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-focus sm:grid"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
              {children}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}
