import type { BlockChange, PMNode } from '@morrow/editor'
import { RichText } from '@/components/reader/rich-text'

/**
 * What changed between two versions of a text, in reading order: proposals (FR-015), versions (FR-019) and branches
 * (FR-018). Added text is underlined, removed text struck through, and each changed paragraph is labelled in words,
 * so meaning never depends on colour alone.
 */
export function DiffView({
  changes,
  chapterVersions = {},
}: {
  changes: BlockChange[]
  chapterVersions?: Record<string, unknown>
}) {
  const visible = changes.some((c) => c.type !== 'same')
  if (!visible) return <p className="font-ui text-sm italic text-secondary">No changes to the text yet.</p>
  return (
    <div className="manuscript">
      <div className="reading-body flex flex-col gap-1">
        {changes.map((c) => {
          const contested = chapterVersions[c.id] as PMNode | undefined
          if (c.type === 'same')
            return (
              <RichText
                key={c.id}
                doc={{ type: 'doc', content: [c.block] }}
                className="text-secondary [&_p]:!indent-0"
              />
            )
          return (
            <section
              key={c.id}
              aria-label={label(c.type)}
              className={`relative my-2 rounded-sm border-l-2 pl-4 ${contested ? 'border-[var(--text-warning)]' : 'border-action'}`}
            >
              <p className="mb-1 font-ui text-[11px] uppercase tracking-[0.08em] text-tertiary">
                {label(c.type)}
                {contested ? ' · also changed in the chapter' : ''}
              </p>
              {c.type === 'added' && (
                <RichText
                  doc={{ type: 'doc', content: [c.block] }}
                  className="[&_p]:!indent-0 [&_p]:underline [&_p]:decoration-[var(--action-primary-bg)] [&_p]:decoration-2 [&_p]:underline-offset-4"
                />
              )}
              {c.type === 'removed' && (
                <RichText
                  doc={{ type: 'doc', content: [c.block] }}
                  className="text-secondary line-through [&_p]:!indent-0"
                />
              )}
              {c.type === 'changed' && (
                <p className="!indent-0">
                  {c.words.map((w, i) =>
                    w.op === 'same' ? (
                      <span key={i}>{w.text}</span>
                    ) : w.op === 'added' ? (
                      <ins
                        key={i}
                        className="bg-[color-mix(in_srgb,var(--action-primary-bg)_12%,transparent)] underline decoration-[var(--action-primary-bg)] decoration-2 underline-offset-4"
                      >
                        {w.text}
                      </ins>
                    ) : (
                      <del key={i} className="text-secondary">
                        {w.text}
                      </del>
                    ),
                  )}
                </p>
              )}
              {contested && (
                <div className="mt-2 rounded-sm bg-app p-3">
                  <p className="mb-1 font-ui text-[12px] font-medium text-primary">The chapter now reads:</p>
                  <RichText doc={{ type: 'doc', content: [contested] }} className="[&_p]:!indent-0" />
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

const label = (t: BlockChange['type']) => (t === 'added' ? 'Added' : t === 'removed' ? 'Removed' : 'Changed')
