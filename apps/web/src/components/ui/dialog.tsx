'use client'
import type { ReactNode } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

/** Focus is trapped and restored, Escape closes, the backdrop dismisses (React Aria). */
export function Dialog({
  title,
  isOpen,
  onOpenChange,
  children,
}: {
  title: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(25_26_24_/_0.35)] p-4"
    >
      <Modal className="w-full max-w-md rounded-lg border border-subtle bg-raised p-6 shadow-[0_2px_4px_rgb(34_34_31/.06),0_16px_40px_rgb(34_34_31/.14)]">
        <AriaDialog className="outline-none">
          <Heading slot="title" className="mb-4 text-lg font-semibold text-primary">
            {title}
          </Heading>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}
