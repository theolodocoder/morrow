'use client'
import { useState } from 'react'
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Separator } from 'react-aria-components'
import { BlockDialog, ReportDialog } from '@/components/safety/report-dialog'
import { BlockIcon, FlagIcon, LinkIcon, MoreIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'

const item =
  'flex cursor-default items-center gap-2.5 rounded-sm px-3 py-2 text-sm outline-none data-[focused]:bg-hover'

/** The rarely needed things on someone's profile: share it, report it, block them. */
export function ProfileMore({ username, name }: { username: string; name: string }) {
  const [report, setReport] = useState(false)
  const [block, setBlock] = useState(false)
  return (
    <>
      <MenuTrigger>
        <AriaButton
          aria-label="More"
          className="press grid size-10 place-items-center rounded-full border border-control text-primary outline-none hover:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
        >
          <MoreIcon size={18} />
        </AriaButton>
        <Popover
          placement="bottom end"
          className="popover min-w-52 rounded-md border border-subtle bg-raised p-1 shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
        >
          <Menu
            aria-label="More"
            className="outline-none"
            onAction={async (key) => {
              if (key === 'copy') {
                await navigator.clipboard.writeText(window.location.href)
                toast('Link copied')
              }
              if (key === 'report') setReport(true)
              if (key === 'block') setBlock(true)
            }}
          >
            <MenuItem id="copy" className={`${item} text-primary`}>
              <LinkIcon size={16} /> Copy link to profile
            </MenuItem>
            <Separator className="my-1 h-px bg-[var(--border-subtle)]" />
            <MenuItem id="report" className={`${item} text-primary`}>
              <FlagIcon size={16} /> Report
            </MenuItem>
            <MenuItem id="block" className={`${item} text-danger`}>
              <BlockIcon size={16} /> Block
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <ReportDialog target={{ type: 'user', username }} isOpen={report} onOpenChange={setReport} />
      <BlockDialog username={username} name={name} isOpen={block} onOpenChange={setBlock} />
    </>
  )
}
