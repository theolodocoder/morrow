import type { PublicPerson } from '@morrow/contracts'
import { creditLine } from '@morrow/domain'
import { AvatarStack } from '@/components/profile/avatar'

/**
 * The chapter's opening (Hearth): set low on the first screen like a book's chapter page. The label is a plain
 * paragraph, not a heading, so the title stays the page's only h1.
 */
export function ChapterOpener({
  label,
  title,
  credit,
}: {
  label: string | null
  title: string
  credit: PublicPerson[]
}) {
  // the line names three people at most, so it shows only their faces
  const named = credit.slice(0, 3)
  return (
    <header className="flex min-h-[38vh] flex-col justify-end pb-10 sm:pb-14">
      {label && (
        <p className="font-manuscript text-[15px] tracking-[0.06em] text-accent [font-variant-caps:small-caps]">
          {label}
        </p>
      )}
      <h1 className="mb-4 mt-2 font-display text-[44px] leading-[1.05] text-primary sm:text-[60px]">
        {title}
      </h1>
      {named.length > 0 && (
        <p className="flex items-center gap-2 font-ui text-[13px] text-secondary">
          <AvatarStack people={named} size={22} />
          {creditLine(credit.map((p) => p.displayName))}
        </p>
      )}
    </header>
  )
}
