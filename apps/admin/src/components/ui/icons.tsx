/**
 * Morrow's icon set: monoline ink on a 20px grid (1.5 stroke, round caps), drawn to match the logo and the
 * Living Manuscript illustration. Icons are decorative by default: the control around them carries the name.
 * Publish echoes the logo's rising sun; Branch echoes its forking line.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 10H4.5M9 5.5 4.5 10 9 14.5" />
  </Icon>
)
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 8 4.5 4.5L14.5 8" />
  </Icon>
)
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 5.5 9 9m0-9-9 9" />
  </Icon>
)
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
)
export const MoreIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <circle cx="4.5" cy="10" r="1.4" />
    <circle cx="10" cy="10" r="1.4" />
    <circle cx="15.5" cy="10" r="1.4" />
  </Icon>
)
/** a stack of pages: the chapter list */
export const ChaptersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 3.5h8a1 1 0 0 1 1 1v10" />
    <rect x="4" y="5.5" width="9.5" height="11" rx="1" />
    <path d="M6.5 9h4.5M6.5 11.5h4.5M6.5 14h2.5" />
  </Icon>
)
/** a line that forks, as in the logo */
export const BranchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 13.5h4c2.5 0 3.5-1.5 4.5-3.5s2-3.5 4.5-3.5" />
    <path d="M7.5 13.5c2.5 0 3.5.5 4.5 1.5s2 1.5 4.5 1.5" />
    <circle cx="16.5" cy="6.5" r="1" fill="currentColor" />
  </Icon>
)
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="7" r="2.75" />
    <path d="M2.75 16c.6-2.9 2.6-4.5 5.25-4.5s4.65 1.6 5.25 4.5M15.5 6v5M13 8.5h5" />
  </Icon>
)
/** a speech bubble with two written lines */
export const FeedbackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 4h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 2.75V14h-1A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4Z" />
    <path d="M6.5 7.75h7M6.5 10.25h4.5" />
  </Icon>
)
export const CommentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 4h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 2.75V14h-1A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4Z" />
    <path d="M10 6.75v4.5M7.75 9h4.5" />
  </Icon>
)
/** a four-point spark, like the gold dots in the illustrations */
export const ReactIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5c.5 3.2 1.8 5.5 5.5 6.5-3.7 1-5 3.3-5.5 6.5-.5-3.2-1.8-5.5-5.5-6.5 3.7-1 5-3.3 5.5-6.5Z" />
  </Icon>
)
/** a clock turning back: versions */
export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.75 10a6.25 6.25 0 1 0 1.9-4.5" />
    <path d="M3.5 3.75v2.5h2.5M10 6.75V10l2.25 1.5" />
  </Icon>
)
export const FocusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 7V4.5a1 1 0 0 1 1-1H7M13 3.5h2.5a1 1 0 0 1 1 1V7M16.5 13v2.5a1 1 0 0 1-1 1H13M7 16.5H4.5a1 1 0 0 1-1-1V13" />
  </Icon>
)
/** the logo's sun rising over the line */
export const PublishIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 15h15" />
    <path d="M5.75 15a4.25 4.25 0 0 1 8.5 0" />
    <path d="M10 5.25v2M4.6 8.1l1.4 1.4M15.4 8.1 14 9.5" />
  </Icon>
)
/** a pen nib with a spark: suggest a change */
export const ProposeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m11.5 4.5 4 4-7.25 7.25-4.5.5.5-4.5L11.5 4.5Z" />
    <path d="M9.75 6.25l4 4M15.5 2.5v2.5M14.25 3.75h2.5" />
  </Icon>
)
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12.5 4 3.5 3.5-8.5 8.5H4v-3.5L12.5 4Z" />
  </Icon>
)
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.75 5.5h12.5M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.75 10.25a1 1 0 0 0 1 .75h5.5a1 1 0 0 0 1-.75l.75-10.25" />
  </Icon>
)
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
)
export const ResolveIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.75" />
    <path d="m7 10.25 2 2 4-4.5" />
  </Icon>
)
export const ReopenIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 10a6 6 0 1 1-1.75-4.25" />
    <path d="M16.25 3.25V6.5H13" />
  </Icon>
)
export const ReplyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 5 3.5 9.5 8 14" />
    <path d="M3.5 9.5H11a5 5 0 0 1 5 5v1" />
  </Icon>
)
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.75" cy="8.75" r="5" />
    <path d="m12.5 12.5 4 4" />
  </Icon>
)
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6h6.5M14 6h2.5M3.5 14H6M10 14h6.5" />
    <circle cx="12" cy="6" r="2" />
    <circle cx="8" cy="14" r="2" />
  </Icon>
)
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5v9M6 8.75l4 4 4-4M4 16.25h12" />
  </Icon>
)
export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 11.5 5.5 4.5h9l2 7v3.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-3.5Z" />
    <path d="M3.5 11.5h4l1 1.75h3l1-1.75h4" />
  </Icon>
)
// Formatting
export const BoldIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.9}>
    <path d="M6 4h5a3 3 0 0 1 0 6H6V4Zm0 6h5.75a3 3 0 0 1 0 6H6v-6Z" />
  </Icon>
)
export const ItalicIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 4h6M5.5 16h6M11.5 4l-3 12" />
  </Icon>
)
export const UnderlineIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5v6a4 4 0 0 0 8 0v-6M4.5 16.5h11" />
  </Icon>
)
export const StrikeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 10h13M13.5 5.75C13 4.5 11.75 3.75 10 3.75c-2.25 0-3.75 1.1-3.75 2.75 0 .9.4 1.6 1.25 2.1M7 14.5c.6 1.2 1.6 1.75 3.25 1.75 2.25 0 3.75-1.1 3.75-2.75 0-.6-.15-1.1-.5-1.5" />
  </Icon>
)
export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 6 3 10l4 4M13 6l4 4-4 4" />
  </Icon>
)
export const HeadingIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4v12M13 4v12M5 10h8M16 9.5l1.5-1v7.5" />
  </Icon>
)
export const QuoteIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M4 14.5c0-3.5 1.5-6.25 4.25-8l.75 1.1C7.4 8.8 6.6 10 6.5 11.25 7.9 11.3 9 12.3 9 13.75a2.25 2.25 0 0 1-2.4 2.25C5.1 16 4 15.25 4 14.5Zm7 0c0-3.5 1.5-6.25 4.25-8l.75 1.1C14.4 8.8 13.6 10 13.5 11.25c1.4.05 2.5 1.05 2.5 2.5a2.25 2.25 0 0 1-2.4 2.25c-1.5 0-2.6-.75-2.6-1.5Z" />
  </Icon>
)
export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.25 1.5H4.25l1.25-1.5Z" />
    <path d="M8.25 17a1.9 1.9 0 0 0 3.5 0" />
  </Icon>
)
export const AtIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2.75" />
    <path d="M12.75 10v1a2 2 0 0 0 4 0V10a6.75 6.75 0 1 0-2.6 5.3" />
  </Icon>
)
export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="14" height="10.5" rx="1.25" />
    <path d="m3.5 6 6.5 5 6.5-5" />
  </Icon>
)
/** a crescent: quiet hours */
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.75 12.25A6.25 6.25 0 0 1 7.75 4.25a6.25 6.25 0 1 0 8 8Z" />
  </Icon>
)
export const PeopleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.5" cy="7.25" r="2.5" />
    <path d="M2.75 15.5c.5-2.6 2.3-4 4.75-4s4.25 1.4 4.75 4" />
    <path d="M13 5a2.25 2.25 0 0 1 0 4.5M14.25 11.75c1.6.4 2.6 1.6 3 3.75" />
  </Icon>
)
export const BookmarkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3.5h9a.75.75 0 0 1 .75.75V17l-5.25-3.5L4.75 17V4.25a.75.75 0 0 1 .75-.75Z" />
  </Icon>
)
export const ReadingIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 5.5C8.5 4.25 6.25 3.75 3 4v11.5c3.25-.25 5.5.25 7 1.5 1.5-1.25 3.75-1.75 7-1.5V4c-3.25-.25-5.5.25-7 1.5Z" />
    <path d="M10 5.5V17" />
  </Icon>
)
export const FlagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 17V3.75M5 4.25c3-1.5 5 1 8 0v6.5c-3 1-5-1.5-8 0" />
  </Icon>
)
export const BlockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="m5.4 14.6 9.2-9.2" />
  </Icon>
)
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.75 4 5v4.5c0 3.75 2.6 6.6 6 7.75 3.4-1.15 6-4 6-7.75V5l-6-2.25Z" />
  </Icon>
)
