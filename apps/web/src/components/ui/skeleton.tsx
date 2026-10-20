/**
 * Placeholder rows while something loads (design/product-redesign.md §8): the shape of what's coming, shimmering,
 * instead of the word "Loading". Screen readers hear one polite "Loading…"; the shapes themselves are hidden.
 */
export function SkeletonRows({
  count = 3,
  avatar = true,
  lines = 2,
  label = 'Loading…',
}: {
  count?: number
  avatar?: boolean
  lines?: 1 | 2 | 3
  label?: string
}) {
  return (
    <div role="status" className="flex flex-col gap-4 py-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-start gap-3">
          {avatar && <span className="skeleton size-9 shrink-0 rounded-full" />}
          <span className="flex flex-1 flex-col gap-2 pt-1">
            {Array.from({ length: lines }, (_, l) => (
              <span
                key={l}
                className="skeleton h-3 rounded-sm"
                style={{ width: `${[72, 92, 48][(l + i) % 3]}%` }}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

/** A feed post's shape: meta line, title, two lines of opening, actions. */
export function SkeletonPost() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 border-b border-subtle px-4 py-5 sm:px-0">
      <span className="flex items-center gap-2">
        <span className="skeleton size-8 rounded-full" />
        <span className="skeleton h-3 w-40 rounded-sm" />
      </span>
      <span className="skeleton h-5 w-3/4 rounded-sm" />
      <span className="skeleton h-3 w-full rounded-sm" />
      <span className="skeleton h-3 w-5/6 rounded-sm" />
      <span className="mt-1 flex gap-4">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skeleton h-4 w-10 rounded-full" />
        ))}
      </span>
    </div>
  )
}
