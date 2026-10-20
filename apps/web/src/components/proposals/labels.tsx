import type { ProposalSummary } from '@morrow/contracts'

/** Plain words for the proposal lifecycle (PRD FR-014). */
export const STATUS_LABEL: Record<ProposalSummary['status'], string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'In review',
  changes_requested: 'Changes requested',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  superseded: 'Superseded',
}

export const KIND_OPTIONS: { id: ProposalSummary['kind']; label: string; description: string }[] = [
  {
    id: 'edit',
    label: 'Edit this chapter',
    description: 'Change the text in a private copy. Nothing changes until it’s accepted.',
  },
  { id: 'outline', label: 'Chapter outline', description: 'Suggest what happens in a chapter.' },
  { id: 'character', label: 'Character idea', description: 'Propose a character, or a change to one.' },
  { id: 'research', label: 'Research note', description: 'Facts, sources or background the work could use.' },
  { id: 'feedback', label: 'Feedback', description: 'Editorial thoughts for the author.' },
]
export const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((k) => [k.id, k.label])) as Record<
  ProposalSummary['kind'],
  string
>

/** Tone carries meaning in words too; colour is never the only signal (design system §3). */
export function StatusPill({ status }: { status: ProposalSummary['status'] }) {
  const tone =
    status === 'accepted'
      ? 'border-[var(--text-success)] text-success'
      : status === 'changes_requested' || status === 'rejected'
        ? 'border-[var(--text-warning)] text-warning'
        : status === 'draft' || status === 'withdrawn' || status === 'superseded'
          ? 'border-subtle text-secondary'
          : 'border-[var(--text-accent)] text-accent'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[12px] ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}
