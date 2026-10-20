'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { PlusIcon } from '@/components/ui/icons'
import { NewWorkForm } from '@/components/shell/write-sheet'

/** Start a new work from You → Works (the same form as the Write sheet). */
export function NewWorkButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="primary" size="sm" onPress={() => setOpen(true)} className="press rounded-full">
        <PlusIcon size={16} />
        New work
      </Button>
      <Sheet title="Begin a new work" isOpen={open} onOpenChange={setOpen}>
        <NewWorkForm onCancel={() => setOpen(false)} />
      </Sheet>
    </>
  )
}
