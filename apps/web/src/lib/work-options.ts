import type { Work } from '@morrow/contracts'
import type { ChoiceOption } from '@/components/ui/choice'

export const CATEGORY_OPTIONS: ChoiceOption<Work['category']>[] = [
  { id: 'novel', label: 'Novel' },
  { id: 'fiction', label: 'Fiction' },
  { id: 'short_story', label: 'Short story' },
  { id: 'novella', label: 'Novella' },
  { id: 'collection', label: 'Collection' },
  { id: 'poetry', label: 'Poetry' },
  { id: 'essay', label: 'Essay' },
  { id: 'article', label: 'Article' },
  { id: 'research_paper', label: 'Research paper' },
  { id: 'educational', label: 'Educational' },
  { id: 'general_document', label: 'General document' },
  { id: 'other', label: 'Other' },
]

export const VISIBILITY_OPTIONS: ChoiceOption<Work['visibility']>[] = [
  { id: 'private', label: 'Private', description: 'Only you and the people you invite.' },
  {
    id: 'unlisted',
    label: 'Unlisted',
    description: 'Anyone with the link can read what you publish. Not shown in discovery.',
  },
  { id: 'public', label: 'Public', description: 'Anyone can find and read what you publish.' },
]

/** PRD FR-013, stated as consequences. */
export const MODE_OPTIONS: ChoiceOption<Work['collaborationMode']>[] = [
  {
    id: 'direct',
    label: 'Direct',
    description: 'Editors and collaborators write in the manuscript directly.',
  },
  {
    id: 'mixed',
    label: 'Mixed',
    description: 'Editors write directly; collaborators and contributors propose changes for review.',
  },
  {
    id: 'proposal',
    label: 'Proposals only',
    description: 'Only you write directly; everyone else proposes changes for you to review.',
  },
]

export const LICENSE_OPTIONS: ChoiceOption<Work['license']>[] = [
  {
    id: 'all_rights_reserved',
    label: 'All rights reserved',
    description: 'You keep every right. Readers may read, not reuse.',
  },
  { id: 'cc_by', label: 'CC BY', description: 'Others may reuse with credit.' },
  { id: 'cc_by_sa', label: 'CC BY-SA', description: 'Reuse with credit; adaptations share alike.' },
  { id: 'cc_by_nc', label: 'CC BY-NC', description: 'Non-commercial reuse with credit.' },
  { id: 'cc_by_nc_sa', label: 'CC BY-NC-SA', description: 'Non-commercial, credit, share alike.' },
  { id: 'cc0', label: 'CC0', description: 'No rights reserved.' },
]

export const labelOf = <T extends string>(opts: ChoiceOption<T>[], id: T) =>
  opts.find((o) => o.id === id)?.label ?? id
export const splitLabels = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
