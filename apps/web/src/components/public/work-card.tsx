import Link from 'next/link'
import { OPEN_ROLE_LABELS, type DiscoveryWork } from '@morrow/contracts'
import { WorkCover } from '@/components/work-cover'
import { PeopleIcon } from '@/components/ui/icons'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS, labelOf } from '@/lib/work-options'

/** A work in a discovery list or search results. Plain (no hooks), so server and client lists share it. */
export function WorkCard({ w, layout = 'card' }: { w: DiscoveryWork; layout?: 'card' | 'row' }) {
  const meta = (
    <p className="mt-1 text-[12px] text-secondary">
      {labelOf(CATEGORY_OPTIONS, w.category)} · {w.author.displayName}
      {w.collaborators > 1 && (
        <span
          className="ml-1 inline-flex items-center gap-0.5 align-[-2px]"
          title={`${w.collaborators} people`}
        >
          · <PeopleIcon size={13} /> {w.collaborators}
        </span>
      )}
    </p>
  )
  if (layout === 'row')
    return (
      <Link href={routes.publicWork(w.publicPath)} className="lift flex gap-4 py-4 hover:bg-hover">
        <WorkCover cover={w.cover} title={w.title} />
        <div className="min-w-0 flex-1">
          <p className="font-manuscript text-[18px] leading-snug text-primary">{w.title}</p>
          {meta}
          {w.description && <p className="mt-1 line-clamp-2 text-[14px] text-secondary">{w.description}</p>}
        </div>
      </Link>
    )
  return (
    <Link
      href={routes.publicWork(w.publicPath)}
      className="lift group flex w-[156px] shrink-0 flex-col sm:w-[180px]"
    >
      <WorkCover cover={w.cover} title={w.title} size="card" />
      <p className="mt-3 line-clamp-2 font-manuscript text-[16px] leading-snug text-primary group-hover:underline">
        {w.title}
      </p>
      {meta}
      {w.openRoles && w.openRoles.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {w.openRoles.slice(0, 2).map((r) => (
            <span key={r} className="rounded-full bg-selected px-1.5 py-px text-[11px] text-primary">
              {OPEN_ROLE_LABELS[r as keyof typeof OPEN_ROLE_LABELS] ?? r}
            </span>
          ))}
        </p>
      )}
      {w.note && (
        <p className="mt-1.5 line-clamp-3 font-manuscript text-[13px] italic text-secondary">“{w.note}”</p>
      )}
    </Link>
  )
}
