import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES,
  PARTICIPATION,
  ROLES,
  VISIBILITIES,
  can,
  capabilitiesFor,
  type AccessContext,
  type Capability,
  type Role,
} from '../src/index.ts'

const OWNER = 'u-owner',
  ALICE = 'u-alice'
const ctx = (
  over: Partial<AccessContext['work']> = {},
  role: Role | null = null,
  branch?: AccessContext['branch'],
): AccessContext => ({
  work: { ownerId: OWNER, visibility: 'private', participation: 'none', ...over },
  role,
  ...(branch ? { branch } : {}),
})

// The member matrix, written out literally from architecture §11 so the test is not the implementation.
const MATRIX: Record<Role, Capability[]> = {
  owner: [...CAPABILITIES],
  editor: [
    'work.read',
    'work.read_published',
    'document.edit',
    'branch.create',
    'branch.edit',
    'proposal.create',
    'proposal.review',
    'comment.create',
    'comment.moderate',
    'reaction.create',
  ],
  // PRD §9: collaborators write directly only in direct mode (the default); they never review.
  collaborator: [
    'work.read',
    'work.read_published',
    'document.edit',
    'branch.create',
    'proposal.create',
    'comment.create',
    'reaction.create',
  ],
  contributor: [
    'work.read',
    'work.read_published',
    'branch.create',
    'proposal.create',
    'comment.create',
    'reaction.create',
  ],
  // P-032: readers give feedback (comments, reactions) but never change the text.
  viewer: ['work.read', 'work.read_published', 'comment.create', 'reaction.create'],
}

describe('member capability matrix in direct mode (every role × capability × visibility × participation)', () => {
  for (const role of ROLES)
    for (const visibility of VISIBILITIES)
      for (const participation of PARTICIPATION) {
        it(`${role} on ${visibility}/${participation}`, () => {
          const user = role === 'owner' ? OWNER : ALICE
          expect(capabilitiesFor({ userId: user }, ctx({ visibility, participation }, role))).toEqual(
            MATRIX[role],
          )
        })
      }
})

describe('non-members', () => {
  it('get nothing at all on a private work', () => {
    for (const p of PARTICIPATION)
      expect(capabilitiesFor({ userId: ALICE }, ctx({ participation: p }))).toEqual([])
  })
  it('can only read published content of an unlisted work, whatever the participation policy', () => {
    for (const p of PARTICIPATION)
      expect(capabilitiesFor({ userId: ALICE }, ctx({ visibility: 'unlisted', participation: p }))).toEqual([
        'work.read_published',
      ])
  })
  it.each([
    ['none', ['work.read_published']],
    ['propose', ['work.read_published', 'proposal.create']],
    ['branch', ['work.read_published', 'branch.create']],
    ['propose_and_branch', ['work.read_published', 'branch.create', 'proposal.create']],
  ] as const)('on a public work with participation=%s get %j', (participation, expected) => {
    expect(capabilitiesFor({ userId: ALICE }, ctx({ visibility: 'public', participation }))).toEqual(expected)
  })
  it('signed-out visitors can only ever read published content', () => {
    for (const v of VISIBILITIES)
      for (const p of PARTICIPATION)
        expect(capabilitiesFor({ userId: null }, ctx({ visibility: v, participation: p }))).toEqual(
          v === 'private' ? [] : ['work.read_published'],
        )
  })
})

describe('invariants', () => {
  it('only the owner manages members, settings, publishing and deletion', () => {
    const ownerOnly: Capability[] = [
      'work.manage_members',
      'work.manage_settings',
      'work.publish',
      'work.delete',
    ]
    for (const role of [...ROLES.filter((r) => r !== 'owner'), null])
      for (const v of VISIBILITIES)
        for (const p of PARTICIPATION)
          for (const c of ownerOnly)
            expect(can({ userId: ALICE }, c, ctx({ visibility: v, participation: p }, role))).toBe(false)
  })
  it('the owner relationship wins even without a membership row', () => {
    expect(capabilitiesFor({ userId: OWNER }, ctx({}, null))).toEqual([...CAPABILITIES])
  })
  it('a deleted work grants nothing to anyone', () => {
    for (const role of [...ROLES, null])
      expect(
        capabilitiesFor(
          { userId: role === 'owner' ? OWNER : ALICE },
          ctx({ deleted: true, visibility: 'public' }, role),
        ),
      ).toEqual([])
  })
  it('a suspended member keeps only published reading', () => {
    expect(capabilitiesFor({ userId: ALICE, suspended: true }, ctx({}, 'editor'))).toEqual([
      'work.read_published',
    ])
  })
})

describe('branch.edit', () => {
  const own = { createdBy: ALICE, isDefault: false },
    other = { createdBy: 'u-bob', isDefault: false },
    main = { createdBy: OWNER, isDefault: true }
  it('the default branch follows document.edit', () => {
    expect(can({ userId: ALICE }, 'branch.edit', ctx({}, 'editor', main))).toBe(true)
    expect(can({ userId: ALICE }, 'branch.edit', ctx({}, 'contributor', main))).toBe(false)
  })
  it("a contributor edits their own branch but not someone else's", () => {
    expect(can({ userId: ALICE }, 'branch.edit', ctx({}, 'contributor', own))).toBe(true)
    expect(can({ userId: ALICE }, 'branch.edit', ctx({}, 'contributor', other))).toBe(false)
  })
  it('a creator downgraded to viewer can no longer edit their branch', () => {
    expect(can({ userId: ALICE }, 'branch.edit', ctx({}, 'viewer', own))).toBe(false)
  })
  it('a non-member creator keeps editing only while the public work still allows branches', () => {
    expect(
      can(
        { userId: ALICE },
        'branch.edit',
        ctx({ visibility: 'public', participation: 'branch' }, null, own),
      ),
    ).toBe(true)
    expect(
      can({ userId: ALICE }, 'branch.edit', ctx({ visibility: 'public', participation: 'none' }, null, own)),
    ).toBe(false)
  })
  it('owners and editors can edit any branch', () => {
    expect(can({ userId: OWNER }, 'branch.edit', ctx({}, 'owner', other))).toBe(true)
    expect(can({ userId: ALICE }, 'branch.edit', ctx({}, 'editor', other))).toBe(true)
  })
})

describe('collaboration modes (PRD FR-013): who writes the canonical text directly', () => {
  const writers = (mode: 'direct' | 'mixed' | 'proposal', section?: 'direct' | 'mixed' | 'proposal' | null) =>
    ROLES.filter((r) =>
      can({ userId: r === 'owner' ? OWNER : ALICE }, 'document.edit', {
        ...ctx({ collaborationMode: mode }, r),
        ...(section !== undefined ? { section: { collaborationMode: section } } : {}),
      }),
    )
  it('direct: owner, editors and collaborators', () =>
    expect(writers('direct')).toEqual(['owner', 'editor', 'collaborator']))
  it('mixed: owner and editors; collaborators propose', () =>
    expect(writers('mixed')).toEqual(['owner', 'editor']))
  it('proposal: only the owner', () => expect(writers('proposal')).toEqual(['owner']))
  it('a section’s own mode overrides the work’s, and null inherits it', () => {
    expect(writers('direct', 'proposal')).toEqual(['owner'])
    expect(writers('proposal', 'direct')).toEqual(['owner', 'editor', 'collaborator'])
    expect(writers('mixed', null)).toEqual(['owner', 'editor'])
  })
  it('everyone who cannot write directly but has access can still propose (except readers)', () => {
    for (const r of ['editor', 'collaborator', 'contributor'] as const)
      expect(can({ userId: ALICE }, 'proposal.create', ctx({ collaborationMode: 'proposal' }, r))).toBe(true)
    expect(can({ userId: ALICE }, 'proposal.create', ctx({ collaborationMode: 'proposal' }, 'viewer'))).toBe(
      false,
    )
  })
  it('the main branch follows the mode for branch.edit too', () => {
    const main = { createdBy: OWNER, isDefault: true }
    expect(
      can({ userId: ALICE }, 'branch.edit', ctx({ collaborationMode: 'mixed' }, 'collaborator', main)),
    ).toBe(false)
    expect(
      can({ userId: ALICE }, 'branch.edit', ctx({ collaborationMode: 'direct' }, 'collaborator', main)),
    ).toBe(true)
  })
})
