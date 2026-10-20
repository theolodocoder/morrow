'use client'
import {
  Label,
  Radio,
  RadioGroup,
  Select,
  SelectValue,
  Button as AriaButton,
  Popover,
  ListBox,
  ListBoxItem,
} from 'react-aria-components'
import { ChevronDownIcon } from './icons'

export interface ChoiceOption<T extends string> {
  id: T
  label: string
  description?: string
}

/** Radio cards: each option states its consequence in plain words (design system §9). */
export function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: ChoiceOption<T>[]
}) {
  return (
    <RadioGroup value={value} onChange={(v) => onChange(v as T)} className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-primary">{label}</Label>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => (
          <Radio
            key={o.id}
            value={o.id}
            className="flex cursor-default gap-3 rounded-sm border border-subtle px-3 py-2 outline-none data-[selected]:border-control data-[selected]:bg-selected data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
          >
            {({ isSelected }) => (
              <>
                <span
                  aria-hidden="true"
                  className={`mt-1 size-3.5 shrink-0 rounded-full border ${isSelected ? 'border-[5px] border-action' : 'border-control'}`}
                />
                <span>
                  <span className="block text-sm font-medium text-primary">{o.label}</span>
                  {o.description && <span className="block text-[13px] text-secondary">{o.description}</span>}
                </span>
              </>
            )}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: ChoiceOption<T>[]
}) {
  return (
    <Select selectedKey={value} onSelectionChange={(k) => onChange(k as T)} className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-primary">{label}</Label>
      <AriaButton className="flex h-10 items-center justify-between rounded-sm border border-control bg-canvas px-3 text-left text-base text-primary outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus">
        <SelectValue />
        <ChevronDownIcon size={16} className="text-tertiary" />
      </AriaButton>
      <Popover className="min-w-[var(--trigger-width)] rounded-md border border-subtle bg-raised p-1 shadow-[0_6px_16px_rgb(34_34_31/.08)]">
        <ListBox className="max-h-72 overflow-y-auto outline-none">
          {options.map((o) => (
            <ListBoxItem
              key={o.id}
              id={o.id}
              textValue={o.label}
              className="cursor-default rounded-sm px-3 py-2 outline-none data-[focused]:bg-hover data-[selected]:bg-selected"
            >
              <span className="block text-sm text-primary">{o.label}</span>
              {o.description && <span className="block text-[12px] text-secondary">{o.description}</span>}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  )
}
