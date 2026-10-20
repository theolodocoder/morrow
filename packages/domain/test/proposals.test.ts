import { describe, expect, it } from 'vitest'
import {
  canActOnProposal,
  canSeeProposal,
  classify,
  nextStatus,
  proposalActions,
  workspaceMode,
  type AccessContext,
  type Block,
  type ProposalStatus,
} from '../src/index.ts'

const OWNER = 'owner'
const ctx = (
  role: AccessContext['role'],
  mode: 'direct' | 'mixed' | 'proposal' = 'mixed',
): AccessContext => ({
  work: { ownerId: OWNER, visibility: 'private', participation: 'none', collaborationMode: mode },
  role,
})
const p = (status: ProposalStatus, authorId = 'author') => ({ authorId, status })
const author = { userId: 'author' }
const editor = { userId: 'editor' }

describe('proposal lifecycle', () => {
  it('follows the documented transitions', () => {
    expect(nextStatus('draft', 'submit')).toBe('submitted')
    expect(nextStatus('submitted', 'start_review')).toBe('under_review')
    expect(nextStatus('under_review', 'request_changes')).toBe('changes_requested')
    expect(nextStatus('changes_requested', 'submit')).toBe('submitted')
    expect(nextStatus('under_review', 'accept')).toBe('accepted')
    expect(nextStatus('submitted', 'reject')).toBe('rejected')
    expect(nextStatus('changes_requested', 'withdraw')).toBe('withdrawn')
  })
  it('closed proposals accept no further action', () => {
    for (const s of ['accepted', 'rejected', 'withdrawn', 'superseded'] as const)
      for (const a of [
        'submit',
        'accept',
        'reject',
        'withdraw',
        'edit',
        'request_changes',
        'comment',
      ] as const)
        expect(nextStatus(s, a)).toBeNull()
  })
  it('a submitted proposal is frozen for its author, and a draft cannot be accepted', () => {
    expect(nextStatus('submitted', 'edit')).toBeNull()
    expect(nextStatus('draft', 'accept')).toBeNull()
  })
})

describe('proposal permissions', () => {
  it('drafts are private to their author; reviewers see them once submitted', () => {
    expect(canSeeProposal(editor, ctx('editor'), p('draft'))).toBe(false)
    expect(canSeeProposal(editor, ctx('editor'), p('submitted'))).toBe(true)
    expect(canSeeProposal({ userId: 'other' }, ctx('contributor'), p('submitted'))).toBe(false)
    expect(canSeeProposal({ userId: 'other' }, ctx(null), p('submitted'))).toBe(false)
  })
  it('authors edit and submit; reviewers decide; nobody reviews their own proposal', () => {
    expect(proposalActions(author, ctx('contributor'), p('draft'))).toEqual([
      'edit',
      'submit',
      'withdraw',
      'refresh',
    ])
    expect(proposalActions(editor, ctx('editor'), p('submitted'))).toEqual([
      'start_review',
      'request_changes',
      'accept',
      'reject',
      'comment',
    ])
    expect(canActOnProposal({ userId: OWNER }, ctx('owner'), p('submitted', OWNER), 'accept')).toBe(false)
    expect(canActOnProposal({ userId: 'c' }, ctx('contributor'), p('submitted'), 'accept')).toBe(false)
  })
  it('an author downgraded to reader can still withdraw but no longer edit', () => {
    expect(canActOnProposal(author, ctx('viewer'), p('draft'), 'edit')).toBe(false)
    expect(canActOnProposal(author, ctx('viewer'), p('draft'), 'withdraw')).toBe(true)
    expect(workspaceMode(author, ctx('viewer'), p('draft'))).toBe('read')
  })
  it('workspace documents: the author writes while editable, reviewers read, everyone else has no access', () => {
    expect(workspaceMode(author, ctx('collaborator'), p('draft'))).toBe('edit')
    expect(workspaceMode(author, ctx('collaborator'), p('submitted'))).toBe('read')
    expect(workspaceMode(author, ctx('collaborator'), p('changes_requested'))).toBe('edit')
    expect(workspaceMode(editor, ctx('editor'), p('submitted'))).toBe('read')
    expect(workspaceMode(editor, ctx('editor'), p('draft'))).toBe('none')
    expect(workspaceMode({ userId: 'x' }, ctx('viewer'), p('submitted'))).toBe('none')
  })
})

// Signatures stand in for CRDT identity: same id + same sig = untouched.
const b = (id: string, sig = id): Block => ({ id, sig })
const base = [b('a'), b('b'), b('c'), b('d')]

describe('classification (S2)', () => {
  it('fast-forward when the chapter has not moved', () => {
    expect(classify(base, base, [b('a'), b('b'), b('c', 'c2'), b('d')]).kind).toBe('fast-forward')
  })
  it('clean when the two sides touch different blocks', () => {
    const head = [b('h1'), b('a', 'a2'), b('b'), b('c'), b('d')]
    expect(classify(base, head, [b('a'), b('b'), b('c', 'c2'), b('d')]).kind).toBe('clean')
  })
  it('conflict when both change the same block, even if the text ended up equal (identity differs)', () => {
    const r = classify(base, [b('a'), b('b'), b('c', 'h'), b('d')], [b('a'), b('b'), b('c', 'p'), b('d')])
    expect(r).toEqual({ kind: 'conflict', blockIds: ['c'], gaps: [] })
  })
  it('conflict when the proposal inserts next to a block the chapter deleted', () => {
    expect(classify(base, [b('a'), b('b'), b('d')], [b('a'), b('b'), b('c'), b('n'), b('d')]).kind).toBe(
      'conflict',
    )
  })
  it('conflict when both insert in the same place', () => {
    expect(
      classify(base, [b('a'), b('x'), b('b'), b('c'), b('d')], [b('a'), b('y'), b('b'), b('c'), b('d')]).kind,
    ).toBe('conflict')
  })
  it('conflict when a moved block was also edited on the other side', () => {
    expect(
      classify(base, [b('a', 'a2'), b('b'), b('c'), b('d')], [b('b'), b('a'), b('c'), b('d')]).kind,
    ).toBe('conflict')
  })
  it('duplicate block ids are never auto-applied', () => {
    expect(classify(base, [b('a'), b('b'), b('c'), b('d', 'd2')], [...base, b('a', 'copy')]).kind).toBe(
      'conflict',
    )
  })
})

describe('outside contributors (public participation)', () => {
  const open = (participation: 'none' | 'propose'): AccessContext => ({
    work: { ownerId: OWNER, visibility: 'public', participation, collaborationMode: 'mixed' },
    role: null,
  })
  const stranger = { userId: 'stranger' }
  it('can propose on a public work that invites it, see and edit their own, but never refresh from the draft', () => {
    const mine = p('draft', 'stranger')
    expect(canSeeProposal(stranger, open('propose'), mine)).toBe(true)
    expect(proposalActions(stranger, open('propose'), mine)).toEqual(['edit', 'submit', 'withdraw'])
    expect(workspaceMode(stranger, open('propose'), mine)).toBe('edit')
  })
  it('keep seeing and can withdraw their proposal after the owner closes participation', () => {
    const mine = p('submitted', 'stranger')
    expect(canSeeProposal(stranger, open('none'), mine)).toBe(true)
    expect(proposalActions(stranger, open('none'), mine)).toEqual(['withdraw'])
  })
  it('never see anyone else’s, and lose everything if the work goes private', () => {
    expect(canSeeProposal(stranger, open('propose'), p('submitted', 'someone-else'))).toBe(false)
    const closed: AccessContext = {
      ...open('propose'),
      work: { ...open('propose').work, visibility: 'private' },
    }
    expect(canSeeProposal(stranger, closed, p('submitted', 'stranger'))).toBe(false)
  })
})
