'use client'
import type { ReactNode } from 'react'
import { Button as AriaButton, Menu as AriaMenu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'

export interface MenuAction {
  id: string
  label: string
  onAction: () => void
  isDisabled?: boolean
  tone?: 'danger'
  icon?: ReactNode
}

/** Keyboard-navigable action menu (typeahead, arrows, Escape) from React Aria. */
export function ActionMenu({
  label,
  trigger,
  actions,
}: {
  label: string
  trigger: ReactNode
  actions: MenuAction[]
}) {
  return (
    <MenuTrigger>
      <AriaButton
        aria-label={label}
        className="inline-flex size-8 items-center justify-center rounded-sm text-secondary outline-none data-[hovered]:bg-hover data-[hovered]:text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus data-[pressed]:bg-hover"
      >
        {trigger}
      </AriaButton>
      <Popover
        placement="bottom end"
        className="min-w-40 rounded-md border border-subtle bg-raised p-1 shadow-[0_1px_2px_rgb(34_34_31/.06),0_6px_16px_rgb(34_34_31/.08)]"
      >
        <AriaMenu
          className="outline-none"
          disabledKeys={actions.filter((a) => a.isDisabled).map((a) => a.id)}
          onAction={(key) => actions.find((a) => a.id === key)?.onAction()}
        >
          {actions.map((a) => (
            <MenuItem
              key={a.id}
              id={a.id}
              textValue={a.label}
              className={`flex cursor-default items-center gap-2.5 rounded-sm px-3 py-1.5 text-sm outline-none data-[focused]:bg-hover data-[disabled]:opacity-40 ${a.tone === 'danger' ? 'text-danger' : 'text-primary'}`}
            >
              {a.icon && <span className="text-secondary">{a.icon}</span>}
              {a.label}
            </MenuItem>
          ))}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  )
}
