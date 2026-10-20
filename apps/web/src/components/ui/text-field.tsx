'use client'
import {
  FieldError,
  Input,
  Label,
  TextField as AriaTextField,
  Text,
  type TextFieldProps as AriaProps,
} from 'react-aria-components'

export interface TextFieldProps extends AriaProps {
  label: string
  description?: string
  errorMessage?: string
  placeholder?: string
}

export function TextField({ label, description, errorMessage, placeholder, ...props }: TextFieldProps) {
  return (
    <AriaTextField {...props} className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-primary">{label}</Label>
      {/* 16px text prevents iOS zoom; the control border meets 3:1 (design system §3). */}
      <Input
        placeholder={placeholder}
        className="h-10 rounded-sm border border-control bg-canvas px-3 text-base text-primary outline-none placeholder:text-tertiary data-[focused]:ring-2 data-[focused]:ring-focus data-[invalid]:border-danger"
      />
      {description && (
        <Text slot="description" className="text-[13px] text-secondary">
          {description}
        </Text>
      )}
      <FieldError className="text-[13px] text-danger">{errorMessage}</FieldError>
    </AriaTextField>
  )
}
