'use client'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'
const base =
  'press inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors duration-[var(--motion-fast)] outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-canvas data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
const variants: Record<Variant, string> = {
  primary: 'bg-action text-action-fg data-[hovered]:bg-action-hover',
  secondary: 'border border-control text-primary data-[hovered]:bg-hover',
  quiet: 'text-secondary data-[hovered]:bg-hover data-[hovered]:text-primary',
  // Never filled: destructive actions must not look like the primary action (design system §9).
  danger: 'border border-danger text-danger data-[hovered]:bg-hover',
}
const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-9 px-4 text-sm', lg: 'h-10 px-5 text-base' } as const

export interface ButtonProps extends AriaButtonProps {
  variant?: Variant
  size?: keyof typeof sizes
}

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={`${base} ${variants[variant]} ${sizes[size]} ${typeof className === 'string' ? className : ''}`}
    />
  )
}
