/**
 * HTTP contracts for /api/v1 (architecture §12). One Zod schema validates on the server and types the
 * client. Shapes here are the M1 subset; later milestones add to them without breaking existing fields.
 */
import { z } from 'zod'
import { CAPABILITIES, PARTICIPATION, PROPOSAL_KINDS, PROPOSAL_STATUSES, VISIBILITIES } from '@morrow/domain'

/** PRD FR-004 categories. `novella` and `collection` are kept from earlier works. */
export const WORK_CATEGORIES = [
  'fiction',
  'novel',
  'novella',
  'short_story',
  'collection',
  'poetry',
  'article',
  'essay',
  'research_paper',
  'educational',
  'general_document',
  'other',
] as const
export const COLLABORATION_MODES = ['direct', 'mixed', 'proposal'] as const
export const LICENSES = [
  'all_rights_reserved',
  'cc_by',
  'cc_by_sa',
  'cc_by_nc',
  'cc_by_nc_sa',
  'cc0',
] as const
export const ROLE_VALUES = ['owner', 'editor', 'collaborator', 'contributor', 'viewer'] as const

const id = z.uuid()
const title = z.string().trim().min(1, 'Give it a title').max(200)
/** short lowercase labels, deduplicated */
const labelList = (max: number) =>
  z
    .array(z.string().trim().toLowerCase().min(1).max(32))
    .max(max)
    .transform((xs) => [...new Set(xs)])

export const Capability = z.enum(CAPABILITIES)

/** Passage reactions (PRD FR-017): a fixed catalog; each work picks which it offers. */
export const REACTION_KINDS = [
  'beautiful_line',
  'plot_twist',
  'interesting_idea',
  'needs_clarity',
  'important_detail',
  'moved_me',
  'made_me_laugh',
] as const
export type ReactionKind = (typeof REACTION_KINDS)[number]
export const REACTION_LABELS: Record<ReactionKind, string> = {
  beautiful_line: 'Beautiful line',
  plot_twist: 'Plot twist',
  interesting_idea: 'Interesting idea',
  needs_clarity: 'Needs clarity',
  important_detail: 'Important detail',
  moved_me: 'Moved me',
  made_me_laugh: 'Made me laugh',
}

/**
 * A work's cover (P-051): drawn, not uploaded, from a palette, a motif and a title layout the writer picks. Until they
 * pick, it's derived from the work's id, so it looks the same on every page. Image covers wait for storage and
 * moderation.
 */
export const COVER_PALETTES = 8
/** sun, fork, arcs, tide, none */
export const COVER_MOTIFS = 5
export const COVER_LAYOUTS = ['classic', 'centered', 'band'] as const
export const CoverConfig = z.object({
  palette: z
    .number()
    .int()
    .min(0)
    .max(COVER_PALETTES - 1),
  motif: z
    .number()
    .int()
    .min(0)
    .max(COVER_MOTIFS - 1),
  layout: z.enum(COVER_LAYOUTS),
})
export type CoverConfig = z.infer<typeof CoverConfig>
function coverHash(s: string) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
/** The cover a work has before its writer chooses one. */
export function defaultCover(workId: string): CoverConfig {
  const h = coverHash(workId)
  return { palette: h % COVER_PALETTES, motif: (h >>> 4) % 4, layout: 'classic' }
}
/** A stored choice, or the default; a bad stored value falls back rather than breaking a page. */
export function coverOf(workId: string, stored: unknown): CoverConfig {
  const parsed = CoverConfig.safeParse(stored)
  return parsed.success ? parsed.data : defaultCover(workId)
}

/** Open calls (P-058): roles a writer can look for, shown on the work and in Discover. */
export const OPEN_ROLES = [
  'co_writer',
  'editor',
  'proofreader',
  'illustrator',
  'translator',
  'researcher',
  'beta_reader',
  'cover_artist',
] as const
export const OPEN_ROLE_LABELS: Record<(typeof OPEN_ROLES)[number], string> = {
  co_writer: 'Co-writer',
  editor: 'Editor',
  proofreader: 'Proofreader',
  illustrator: 'Illustrator',
  translator: 'Translator',
  researcher: 'Researcher',
  beta_reader: 'Beta reader',
  cover_artist: 'Cover artist',
}
const OpenRoles = z.array(z.enum(OPEN_ROLES)).max(OPEN_ROLES.length)
/** A serial's release day (P-057): 0 = Sunday … 6 = Saturday */
const ReleaseDay = z.number().int().min(0).max(6)

export const Work = z.object({
  id,
  cover: CoverConfig,
  releaseDay: ReleaseDay.nullable(),
  openRoles: OpenRoles,
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  category: z.enum(WORK_CATEGORIES),
  tags: z.array(z.string()),
  contentWarnings: z.array(z.string()),
  reactionKinds: z.array(z.enum(REACTION_KINDS)),
  license: z.enum(LICENSES),
  visibility: z.enum(VISIBILITIES),
  participation: z.enum(PARTICIPATION),
  collaborationMode: z.enum(COLLABORATION_MODES),
  /** public URL path segment once published: {slug}-{publicId} */
  publicPath: z.string(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  /** the writer marked it finished */
  completed: z.boolean(),
  defaultBranchId: id,
  version: z.number().int(),
  wordCount: z.number().int(),
  /** people with access, including the owner */
  memberCount: z.number().int(),
  /** the caller's relationship to the work */
  myRole: z.enum(ROLE_VALUES).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  capabilities: z.array(Capability),
})
export type Work = z.infer<typeof Work>

export const CreateWorkInput = z.object({
  title,
  category: z.enum(WORK_CATEGORIES).default('novel'),
  description: z.string().trim().max(2000).default(''),
})
export type CreateWorkInput = z.input<typeof CreateWorkInput>

/** Visibility changes are explicit and audited; the UI confirms them (P-018). Participation arrives with M6. */
export const UpdateWorkInput = z
  .object({
    title: title.optional(),
    category: z.enum(WORK_CATEGORIES).optional(),
    description: z.string().trim().max(2000).optional(),
    tags: labelList(10).optional(),
    contentWarnings: labelList(10).optional(),
    reactionKinds: z
      .array(z.enum(REACTION_KINDS))
      .max(REACTION_KINDS.length)
      .refine((k) => new Set(k).size === k.length, 'Each reaction once')
      .optional(),
    license: z.enum(LICENSES).optional(),
    visibility: z.enum(VISIBILITIES).optional(),
    collaborationMode: z.enum(COLLABORATION_MODES).optional(),
    /** public participation (M6): 'propose' lets anyone signed in suggest edits to what's published */
    participation: z.enum(['none', 'propose']).optional(),
    /** readers see "Complete" instead of "Ongoing" */
    completed: z.boolean().optional(),
    /** null goes back to the generated cover */
    cover: CoverConfig.nullable().optional(),
    /** null: no schedule */
    releaseDay: ReleaseDay.nullable().optional(),
    openRoles: OpenRoles.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type UpdateWorkInput = z.infer<typeof UpdateWorkInput>

export const Chapter = z.object({
  id,
  workId: id,
  branchId: id,
  documentId: id,
  title: z.string(),
  description: z.string(),
  /** null inherits the work's collaboration mode (FR-006) */
  collaborationMode: z.enum(COLLABORATION_MODES).nullable(),
  position: z.string(),
  wordCount: z.number().int(),
  updatedAt: z.iso.datetime({ offset: true }),
})
export type Chapter = z.infer<typeof Chapter>

export const CreateChapterInput = z.object({
  title: title.default('Untitled chapter'),
  /** insert after this chapter; omit to append at the end */
  afterChapterId: id.optional(),
})
export type CreateChapterInput = z.input<typeof CreateChapterInput>

export const UpdateChapterInput = z
  .object({
    title: title.optional(),
    description: z.string().trim().max(2000).optional(),
    /** owner only; `null` returns to the work's mode */
    collaborationMode: z.enum(COLLABORATION_MODES).nullable().optional(),
    /** move after this chapter; `null` moves it to the start */
    moveAfterChapterId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type UpdateChapterInput = z.infer<typeof UpdateChapterInput>

export const SNAPSHOT_REASONS = [
  'auto',
  'manual',
  'publish',
  'proposal_base',
  'proposal_applied',
  'branch_fork',
  'pre_restore',
  'pre_migration',
] as const
export const Snapshot = z.object({
  id,
  documentId: id,
  reason: z.enum(SNAPSHOT_REASONS),
  label: z.string().nullable(),
  wordCount: z.number().int(),
  createdBy: z.string().nullable(),
  /** FR-019 "author attribution where known" */
  createdByName: z.string().nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type Snapshot = z.infer<typeof Snapshot>

export const CreateSnapshotInput = z.object({ label: z.string().trim().min(1).max(120).optional() })

export const CollabTicketInput = z.object({ documentId: id })
export const CollabTicket = z.object({
  ticket: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  collabUrl: z.string(),
  mode: z.enum(['edit', 'read']),
  schemaVersion: z.number().int(),
})
export type CollabTicket = z.infer<typeof CollabTicket>

export const Me = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  username: z.string().nullable(),
  onboarded: z.boolean(),
})
export type Me = z.infer<typeof Me>

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

/** RFC 9457 problem details; `type` is a stable identifier clients may switch on. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
})
export type Problem = z.infer<typeof Problem>

export const PROBLEM = {
  notFound: 'https://morrow.dev/problems/not-found',
  forbidden: 'https://morrow.dev/problems/forbidden',
  preconditionFailed: 'https://morrow.dev/problems/precondition-failed',
  unauthenticated: 'https://morrow.dev/problems/unauthenticated',
  validation: 'https://morrow.dev/problems/validation',
  conflict: 'https://morrow.dev/problems/conflict',
  /** staff tools need two-factor sign-in */
  twoFactorRequired: 'https://morrow.dev/problems/two-factor-required',
  /** a plan limit was reached (FR-034): explain it and point to plans */
  planLimit: 'https://morrow.dev/problems/plan-limit',
  /** the chapter changed in the same places as the proposal: reconcile before accepting */
  proposalConflict: 'https://morrow.dev/problems/proposal-conflict',
  rateLimited: 'https://morrow.dev/problems/rate-limited',
  badOrigin: 'https://morrow.dev/problems/bad-origin',
  internal: 'https://morrow.dev/problems/internal',
} as const

/** Stateless messages from collab to clients (architecture §13). Versioned envelope. */
export const CollabEvent = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('access_changed'), mode: z.enum(['read', 'none']) }),
  z.object({ v: z.literal(1), type: z.literal('save_degraded') }),
  z.object({ v: z.literal(1), type: z.literal('save_recovered') }),
  z.object({
    v: z.literal(1),
    type: z.literal('snapshot_created'),
    snapshotId: id,
    reason: z.enum(SNAPSHOT_REASONS),
  }),
  z.object({ v: z.literal(1), type: z.literal('document_closed'), reason: z.string() }),
  /** comments or reactions on this document changed: refetch them (FR-016/017) */
  z.object({ v: z.literal(1), type: z.literal('feedback_changed'), what: z.enum(['comments', 'reactions']) }),
])
export type CollabEvent = z.infer<typeof CollabEvent>

// ---- M2: members and invitations ----
/** Roles a member can be given. Ownership is not assignable here (transfer comes later). */
export const ASSIGNABLE_ROLES = ['editor', 'collaborator', 'contributor', 'viewer'] as const

export const Member = z.object({
  userId: z.string(),
  name: z.string(),
  /** visible to the owner only; other members see names */
  email: z.email().nullable(),
  role: z.enum(['owner', ...ASSIGNABLE_ROLES]),
  joinedAt: z.iso.datetime({ offset: true }),
})
export type Member = z.infer<typeof Member>

export const Invitation = z.object({
  id,
  email: z.email(),
  role: z.enum(ASSIGNABLE_ROLES),
  invitedBy: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
})
export type Invitation = z.infer<typeof Invitation>

export const CreateInvitationInput = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  role: z.enum(ASSIGNABLE_ROLES),
})
export type CreateInvitationInput = z.input<typeof CreateInvitationInput>

/** Returned once, at creation: the link is the bearer secret and is never retrievable again. */
export const CreatedInvitation = Invitation.extend({ inviteUrl: z.url() })
export type CreatedInvitation = z.infer<typeof CreatedInvitation>

export const UpdateMemberInput = z.object({ role: z.enum(ASSIGNABLE_ROLES) })

/** What someone holding an invite link may see before accepting. */
export const InvitationPreview = z.object({
  workTitle: z.string(),
  invitedByName: z.string(),
  role: z.enum(ASSIGNABLE_ROLES),
  emailHint: z.string(), // e.g. "a***@example.com"
  status: z.enum(['pending', 'expired', 'used', 'revoked']),
})
export type InvitationPreview = z.infer<typeof InvitationPreview>

export const AcceptedInvitation = z.object({ workId: id })

// ---- M3: branches and history ----
export const Branch = z.object({
  id,
  workId: id,
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  status: z.enum(['active', 'abandoned', 'selected']),
  isDefault: z.boolean(),
  parentBranchId: id.nullable(),
  parentBranchName: z.string().nullable(),
  createdBy: z.string(),
  createdByName: z.string(),
  /** display lineage: "diverges at Chapter 7" */
  divergesAtChapterTitle: z.string().nullable(),
  chapterCount: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  capabilities: z.array(Capability),
})
export type Branch = z.infer<typeof Branch>

export const CreateBranchInput = z.object({
  name: z.string().trim().min(1, 'Name this direction').max(120),
  description: z.string().trim().max(2000).default(''),
  fromBranchId: id,
  /** a chapter of the source branch where the new direction begins (display only) */
  divergesAtChapterId: id.optional(),
})
export type CreateBranchInput = z.input<typeof CreateBranchInput>

export const UpdateBranchInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(['active', 'abandoned', 'selected']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export const RestoreInput = z.object({ snapshotId: id })

// ---- Profiles and onboarding (PRD FR-002/003) ----
/** Words that would collide with routes or impersonate the platform. */
export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'auth',
  'about',
  'authors',
  'discover',
  'guidelines',
  'help',
  'invite',
  'library',
  'login',
  'logout',
  'me',
  'moderator',
  'morrow',
  'new',
  'pricing',
  'privacy',
  'settings',
  'signin',
  'signup',
  'sign-in',
  'sign-up',
  'staff',
  'support',
  'system',
  'terms',
  'works',
  'www',
])
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, 'Use 3–30 lowercase letters, numbers or underscores.')
  .refine((u) => !RESERVED_USERNAMES.has(u), 'That username is reserved.')

export const PROFILE_INTENTS = ['write', 'collaborate', 'read', 'edit_review', 'organize'] as const
const ProfileLink = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.url().refine((u) => /^https?:\/\//i.test(u), 'Links must start with http:// or https://'),
})

// ---- Avatars (FR-002): built from parts, drawn as SVG in the browser; no uploads ----
/** How many choices each part has. The UI and the renderer share these, and the server validates against them. */
export const AVATAR_PARTS = {
  skin: 6,
  hair: 9,
  hairColor: 7,
  eyes: 5,
  mouth: 5,
  accessory: 4,
  background: 8,
} as const
const part = (n: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(n - 1)
export const AvatarConfig = z.discriminatedUnion('style', [
  z.object({
    style: z.literal('face'),
    skin: part(AVATAR_PARTS.skin),
    hair: part(AVATAR_PARTS.hair),
    hairColor: part(AVATAR_PARTS.hairColor),
    eyes: part(AVATAR_PARTS.eyes),
    mouth: part(AVATAR_PARTS.mouth),
    accessory: part(AVATAR_PARTS.accessory),
    background: part(AVATAR_PARTS.background),
  }),
  z.object({ style: z.literal('initials'), background: part(AVATAR_PARTS.background) }),
])
export type AvatarConfig = z.infer<typeof AvatarConfig>

/** Anyone shown on a public page. `username` is null when their profile is private (no link to it). */
/** The badge worn on someone's avatar: their latest, and how many they have. Absent if they hide badges. */
export const AvatarBadge = z.object({ code: z.string(), name: z.string(), count: z.number().int() })
export type AvatarBadge = z.infer<typeof AvatarBadge>
export const PublicPerson = z.object({
  displayName: z.string(),
  username: z.string().nullable(),
  avatarSeed: z.string(),
  avatar: AvatarConfig.nullable(),
  badge: AvatarBadge.nullable().optional(),
})
export type PublicPerson = z.infer<typeof PublicPerson>

// ---- Badges (FR-025) ----
export const Badge = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string(),
  awardedAt: z.iso.datetime({ offset: true }),
})
export type Badge = z.infer<typeof Badge>
export const MyBadges = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      description: z.string(),
      awardedAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
  showOnProfile: z.boolean(),
})
export type MyBadges = z.infer<typeof MyBadges>

export const Profile = z.object({
  username: z.string(),
  displayName: z.string(),
  bio: z.string(),
  interests: z.array(z.string()),
  genres: z.array(z.string()),
  links: z.array(ProfileLink),
  avatarSeed: z.string(),
  avatar: AvatarConfig.nullable(),
  isPublic: z.boolean(),
  showBio: z.boolean(),
  showInterests: z.boolean(),
  showLinks: z.boolean(),
  showFollows: z.boolean(),
  showBadges: z.boolean(),
  onboarded: z.boolean(),
})
export type Profile = z.infer<typeof Profile>

export const UpdateProfileInput = z.object({
  username: Username.optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().max(500).optional(),
  interests: z.array(z.enum(PROFILE_INTENTS)).max(PROFILE_INTENTS.length).optional(),
  genres: labelList(12).optional(),
  links: z.array(ProfileLink).max(5).optional(),
  isPublic: z.boolean().optional(),
  showBio: z.boolean().optional(),
  showInterests: z.boolean().optional(),
  showLinks: z.boolean().optional(),
  showFollows: z.boolean().optional(),
  showBadges: z.boolean().optional(),
  /** null goes back to initials */
  avatar: AvatarConfig.nullable().optional(),
  /** finishing (or skipping) onboarding */
  onboarded: z.literal(true).optional(),
})
export type UpdateProfileInput = z.input<typeof UpdateProfileInput>

export const UsernameAvailability = z.object({
  username: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
})
export type UsernameAvailability = z.infer<typeof UsernameAvailability>

export const PublicWorkSummary = z.object({
  title: z.string(),
  description: z.string(),
  category: z.enum(WORK_CATEGORIES),
  publicPath: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
  wordCount: z.number().int(),
})
export type PublicWorkSummary = z.infer<typeof PublicWorkSummary>

/** What anyone may see about an author: only what they chose to show (FR-002). */
export const PublicAuthor = z.object({
  username: z.string(),
  displayName: z.string(),
  avatarSeed: z.string(),
  avatar: AvatarConfig.nullable(),
  bio: z.string().nullable(),
  interests: z.array(z.string()).nullable(),
  genres: z.array(z.string()).nullable(),
  links: z.array(ProfileLink).nullable(),
  joinedAt: z.iso.datetime({ offset: true }),
  works: z.array(PublicWorkSummary),
  /** null when the author keeps follow counts private (FR-022) */
  followers: z.number().int().nullable(),
  following: z.number().int().nullable(),
  /** null when the author hides their badges */
  badges: z.array(Badge).nullable(),
  /** works they've collaborated on (not their own), public and published */
  collaborations: z.array(PublicWorkSummary),
})
export type PublicAuthor = z.infer<typeof PublicAuthor>

// ---- Publishing and reading (PRD FR-023, P-014) ----
export const PublishInput = z.object({ visibility: z.enum(['public', 'unlisted']).optional() })

/** The editor's view of what readers currently see. */
export const PublicationStatus = z.object({
  published: z.boolean(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  publicPath: z.string(),
  visibility: z.enum(VISIBILITIES),
  branchName: z.string().nullable(),
  chapterCount: z.number().int(),
})
export type PublicationStatus = z.infer<typeof PublicationStatus>

export const PublicChapterSummary = z.object({
  title: z.string(),
  slug: z.string(),
  wordCount: z.number().int(),
})
/** A public-domain classic (P-063): who really wrote it, and when. */
export const ClassicInfo = z.object({ author: z.string(), year: z.number().int() })
export const PublicWork = z.object({
  cover: CoverConfig,
  classic: ClassicInfo.nullable(),
  releaseDay: ReleaseDay.nullable(),
  openRoles: OpenRoles,
  /** anyone signed in may suggest edits (public participation) */
  openToSuggestions: z.boolean(),
  title: z.string(),
  description: z.string(),
  category: z.enum(WORK_CATEGORIES),
  tags: z.array(z.string()),
  contentWarnings: z.array(z.string()),
  license: z.enum(LICENSES),
  publicPath: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
  /** unlisted works must not be indexed by search engines */
  indexable: z.boolean(),
  versionName: z.string().nullable(),
  author: PublicPerson,
  /** people who actually edited the published chapters (from server-side edit sessions) */
  contributors: z.array(PublicPerson),
  chapters: z.array(PublicChapterSummary),
  wordCount: z.number().int(),
  completed: z.boolean(),
  likes: z.number().int(),
  views: z.number().int(),
  comments: z.number().int(),
})
export type PublicWork = z.infer<typeof PublicWork>

export const PublicChapter = z.object({
  title: z.string(),
  slug: z.string(),
  index: z.number().int(),
  content: z.unknown(),
  wordCount: z.number().int(),
  prev: PublicChapterSummary.nullable(),
  next: PublicChapterSummary.nullable(),
})
export type PublicChapter = z.infer<typeof PublicChapter>

// ---- Proposals (PRD FR-014/015) ----
export { PROPOSAL_KINDS, PROPOSAL_STATUSES }
const PersonRef = z.object({ id: z.string(), name: z.string() })

export const PROPOSAL_ACTIONS = [
  'edit',
  'submit',
  'start_review',
  'request_changes',
  'accept',
  'reject',
  'withdraw',
  'refresh',
  'comment',
] as const

export const ProposalSummary = z.object({
  id: z.uuid(),
  workId: z.uuid(),
  kind: z.enum(PROPOSAL_KINDS),
  status: z.enum(PROPOSAL_STATUSES),
  title: z.string(),
  explanation: z.string(),
  author: PersonRef,
  reviewer: PersonRef.nullable(),
  chapter: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
})
export type ProposalSummary = z.infer<typeof ProposalSummary>

export const ProposalEvent = z.object({
  id: z.uuid(),
  type: z.enum(['comment', 'status']),
  body: z.string(),
  fromStatus: z.enum(PROPOSAL_STATUSES).nullable(),
  toStatus: z.enum(PROPOSAL_STATUSES).nullable(),
  actor: PersonRef,
  createdAt: z.iso.datetime({ offset: true }),
})
export type ProposalEvent = z.infer<typeof ProposalEvent>

export const ProposalClassification = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fast-forward') }),
  z.object({ kind: z.literal('clean') }),
  z.object({ kind: z.literal('conflict'), blockIds: z.array(z.string()), gaps: z.array(z.string()) }),
])

export const ProposalDetail = ProposalSummary.extend({
  /** false for outside contributors: they see only published text, so no live comparison or refresh */
  viewerSeesDrafts: z.boolean(),
  body: z.string(),
  workspaceDocumentId: z.uuid().nullable(),
  /** what the caller may do now; the UI renders these, never decides them */
  actions: z.array(z.enum(PROPOSAL_ACTIONS)),
  events: z.array(ProposalEvent),
  /** edits only: how the proposal stands against the chapter now, and what it changes (base → proposal) */
  review: z
    .object({
      /** null when the proposal is closed, or the live comparison is temporarily unavailable */
      classification: ProposalClassification.nullable(),
      /** BlockChange[] from @morrow/editor diffDocuments */
      changes: z.array(z.unknown()),
      /** the chapter's current version of blocks both sides changed, for side-by-side reconciliation */
      chapterVersions: z.record(z.string(), z.unknown()),
    })
    .nullable(),
})
export type ProposalDetail = z.infer<typeof ProposalDetail>

export const CreateProposalInput = z
  .object({
    kind: z.enum(PROPOSAL_KINDS),
    title: z.string().trim().min(1).max(200),
    explanation: z.string().trim().max(4000).default(''),
    body: z.string().trim().max(20000).default(''),
    chapterId: z.uuid().optional(),
  })
  .refine((v) => v.kind !== 'edit' || v.chapterId, {
    message: 'An edit needs a chapter.',
    path: ['chapterId'],
  })
export type CreateProposalInput = z.input<typeof CreateProposalInput>

export const UpdateProposalInput = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    explanation: z.string().trim().max(4000).optional(),
    body: z.string().trim().max(20000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const ProposalNoteInput = z.object({ note: z.string().trim().max(4000).default('') })
/** Accept; `resolve: 'use_proposal'` is the reviewer's explicit choice to use the proposal's wording where both changed. */
export const AcceptProposalInput = ProposalNoteInput.extend({ resolve: z.enum(['use_proposal']).optional() })
export const ProposalCommentInput = z.object({ body: z.string().trim().min(1).max(4000) })

export const RefreshProposalResult = z.object({
  reference: z.array(z.object({ blockId: z.string(), chapter: z.unknown(), proposal: z.unknown() })),
})

// ---- Feedback: inline comments and passage reactions (PRD FR-016/017) ----
const YId = z.object({ client: z.number().int().nonnegative(), clock: z.number().int().nonnegative() })
/** Y.relativePositionToJSON output: a small fixed shape, validated so no arbitrary JSON is stored. */
const RelativePosition = z.strictObject({
  type: YId.nullable().optional(),
  tname: z.string().max(100).nullable().optional(),
  item: YId.nullable().optional(),
  assoc: z.number().int().min(-1).max(0).optional(),
})
export const CommentAnchor = z.object({
  start: RelativePosition,
  end: RelativePosition,
  quote: z.string().max(500),
  blockId: z.string().max(100).nullable(),
})
export type CommentAnchor = z.infer<typeof CommentAnchor>

export const Comment = z.object({
  id: z.uuid(),
  author: z.object({ id: z.string(), name: z.string() }),
  /** empty when deleted */
  body: z.string(),
  mentions: z.array(z.object({ id: z.string(), name: z.string(), username: z.string() })),
  createdAt: z.iso.datetime({ offset: true }),
  editedAt: z.iso.datetime({ offset: true }).nullable(),
  deleted: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
})
export type Comment = z.infer<typeof Comment>

export const CommentThread = z.object({
  id: z.uuid(),
  anchor: CommentAnchor,
  resolved: z
    .object({ at: z.iso.datetime({ offset: true }), by: z.object({ id: z.string(), name: z.string() }) })
    .nullable(),
  canResolve: z.boolean(),
  comments: z.array(Comment),
})
export type CommentThread = z.infer<typeof CommentThread>

export const CommentList = z.object({ items: z.array(CommentThread), canComment: z.boolean() })
export const CreateCommentInput = z.object({
  body: z.string().trim().min(1).max(4000),
  anchor: CommentAnchor,
})
export const CommentBodyInput = z.object({ body: z.string().trim().min(1).max(4000) })

export const ReactionsSummary = z.object({
  /** what this work offers; empty means reactions are off */
  kinds: z.array(z.enum(REACTION_KINDS)),
  canReact: z.boolean(),
  /** blockId → kind → count */
  counts: z.record(z.string(), z.partialRecord(z.enum(REACTION_KINDS), z.number().int())),
  /** blockId → the caller's own reactions */
  mine: z.record(z.string(), z.array(z.enum(REACTION_KINDS))),
})
export type ReactionsSummary = z.infer<typeof ReactionsSummary>
export const ReactionInput = z.object({ blockId: z.string().min(1).max(100), kind: z.enum(REACTION_KINDS) })

/** New feedback since the caller last opened this chapter's feedback, counting only what concerns them. */
export const FeedbackUnread = z.object({ comments: z.number().int(), reactions: z.number().int() })
export type FeedbackUnread = z.infer<typeof FeedbackUnread>

/** Someone who can be @mentioned on a work. */
export const Mentionable = z.object({ id: z.string(), name: z.string(), username: z.string() })
export type Mentionable = z.infer<typeof Mentionable>

// ---- Comparing revisions and branches, merging (PRD FR-018/019) ----
export const RevisionCompare = z.object({
  from: z.object({ label: z.string(), createdAt: z.iso.datetime({ offset: true }).nullable() }),
  to: z.object({ label: z.string(), createdAt: z.iso.datetime({ offset: true }).nullable() }),
  /** BlockChange[] from @morrow/editor */
  changes: z.array(z.unknown()),
  summary: z.object({ changed: z.number().int(), added: z.number().int(), removed: z.number().int() }),
})
export type RevisionCompare = z.infer<typeof RevisionCompare>

export const BranchChapterComparison = z.object({
  title: z.string(),
  /** relative to the other branch: what this branch does differently */
  status: z.enum(['same', 'changed', 'only_here', 'only_there']),
  chapterId: z.uuid().nullable(),
  otherChapterId: z.uuid().nullable(),
  otherTitle: z.string().nullable(),
  changes: z.array(z.unknown()),
  summary: z.object({ changed: z.number().int(), added: z.number().int(), removed: z.number().int() }),
})
export const BranchCompare = z.object({
  branch: z.object({ id: z.uuid(), name: z.string() }),
  other: z.object({ id: z.uuid(), name: z.string() }),
  chapters: z.array(BranchChapterComparison),
  /** whether the caller may merge this branch into the other (it must be the parent, and writable) */
  canMerge: z.boolean(),
})
export type BranchCompare = z.infer<typeof BranchCompare>

export const MergeChapterOutcome = z.object({
  title: z.string(),
  outcome: z.enum(['merged', 'added', 'unchanged', 'conflict', 'kept', 'not_attempted']),
  /** conflict: the paragraphs both sides changed */
  blockIds: z.array(z.string()).optional(),
})
export const MergeResult = z.object({
  mergeId: z.uuid(),
  status: z.enum(['merged', 'conflict', 'partial']),
  chapters: z.array(MergeChapterOutcome),
})
export type MergeResult = z.infer<typeof MergeResult>

// ---- Notifications (PRD FR-030) ----
export const NOTIFICATION_CATEGORIES = [
  'invitations',
  'proposals',
  'comments',
  'mentions',
  'publishing',
  'activity',
] as const
export const NotificationItem = z.object({
  id: z.uuid(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  read: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type NotificationItem = z.infer<typeof NotificationItem>
export const NotificationList = z.object({
  items: z.array(NotificationItem),
  nextCursor: z.string().nullable(),
  unread: z.number().int(),
})
export const MarkReadInput = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
])

const Channel = z.object({ inApp: z.boolean(), email: z.boolean() })
export const NotificationPreferences = z.object({
  categories: z.record(z.enum(NOTIFICATION_CATEGORIES), Channel),
  /** minutes after local midnight, e.g. 22:00 = 1320; both null = no quiet hours */
  quietStart: z.number().int().min(0).max(1439).nullable(),
  quietEnd: z.number().int().min(0).max(1439).nullable(),
  timeZone: z.string().max(64),
})
export type NotificationPreferences = z.infer<typeof NotificationPreferences>
export const UpdateNotificationPreferences = NotificationPreferences.partial().extend({
  categories: z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), Channel).optional(),
})

export const MyInvitation = z.object({
  id: z.uuid(),
  workTitle: z.string(),
  invitedByName: z.string(),
  role: z.enum(ASSIGNABLE_ROLES),
  expiresAt: z.iso.datetime({ offset: true }),
})
export const MyInvitations = z.object({
  items: z.array(MyInvitation),
  /** invitations show here only for a verified email address; until then, use the emailed link */
  verified: z.boolean(),
})

// ---- Following and bookmarks (PRD FR-022) ----
export const FollowTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('author'), username: z.string().min(3).max(30) }),
  z.object({ type: z.literal('work'), publicPath: z.string().min(3).max(200) }),
])
export const BookmarkInput = z.object({ publicPath: z.string().min(3).max(200) })
export const FollowState = z.object({
  followingAuthor: z.boolean(),
  followingWork: z.boolean(),
  bookmarked: z.boolean(),
  liked: z.boolean(),
  isMe: z.boolean(),
})
export type FollowState = z.infer<typeof FollowState>

export const ReadingListWork = z.object({
  title: z.string(),
  description: z.string(),
  category: z.enum(WORK_CATEGORIES),
  authorName: z.string(),
  /** public reading page, when readers can see it */
  publicPath: z.string().nullable(),
  /** the in-app editor, when the work is no longer public but you're a member */
  appWorkId: z.uuid().nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
})
export const ReadingList = z.object({
  bookmarks: z.array(ReadingListWork),
  works: z.array(ReadingListWork),
  authors: z.array(
    z.object({
      username: z.string(),
      displayName: z.string(),
      avatarSeed: z.string(),
      avatar: AvatarConfig.nullable(),
    }),
  ),
})
export type ReadingList = z.infer<typeof ReadingList>

// ---- Discovery and search (PRD FR-020/021) ----
export const DiscoveryWork = z.object({
  title: z.string(),
  cover: CoverConfig,
  classic: z.object({ author: z.string(), year: z.number().int() }).optional(),
  openRoles: z.array(z.string()).optional(),
  description: z.string(),
  category: z.enum(WORK_CATEGORIES),
  tags: z.array(z.string()),
  publicPath: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
  author: z.object({ displayName: z.string(), username: z.string().nullable() }),
  /** people working on it, owner included */
  collaborators: z.number().int(),
  wordCount: z.number().int(),
  /** editorial picks only: the curator's line */
  note: z.string().optional(),
})
export type DiscoveryWork = z.infer<typeof DiscoveryWork>

export const Discovery = z.object({
  /** chosen by people (editorial) */
  featured: z.array(DiscoveryWork),
  recent: z.array(DiscoveryWork),
  /** ranked by recent follows and bookmarks (algorithmic) */
  popular: z.array(DiscoveryWork),
  collaborative: z.array(DiscoveryWork),
  seekingContributors: z.array(DiscoveryWork),
  /** open calls (P-058): works whose writers are looking for someone */
  openCalls: z.array(DiscoveryWork),
  /** public-domain classics (P-063) */
  classics: z.array(DiscoveryWork),
  topics: z.array(z.object({ tag: z.string(), works: z.number().int() })),
})
export type Discovery = z.infer<typeof Discovery>

// ---- The public feed (FR-020): a scrolling stream of published pieces ----
/** 'for_you' (P-060) is for signed-in readers: what's popular, weighted toward the kinds, topics and writers they engage with */
export const FEED_SORTS = ['latest', 'popular', 'following', 'for_you'] as const
export const FeedQuery = z.object({
  category: z.enum(WORK_CATEGORIES).optional(),
  sort: z.enum(FEED_SORTS).default('latest'),
  /** opaque: from the previous page */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(12),
})
export const FeedItem = z.object({
  title: z.string(),
  cover: CoverConfig,
  description: z.string(),
  /** the opening lines of the first published chapter */
  excerpt: z.string(),
  category: z.enum(WORK_CATEGORIES),
  tags: z.array(z.string()),
  publicPath: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
  author: PublicPerson,
  /** up to four other people credited on it */
  collaborators: z.array(PublicPerson),
  collaboratorCount: z.number().int(),
  wordCount: z.number().int(),
  completed: z.boolean(),
  likes: z.number().int(),
  views: z.number().int(),
  comments: z.number().int(),
  /** signed-in readers only */
  viewer: z
    .object({
      liked: z.boolean(),
      bookmarked: z.boolean(),
      followingAuthor: z.boolean(),
      isAuthor: z.boolean(),
    })
    .nullable(),
})
export type FeedItem = z.infer<typeof FeedItem>
export const Feed = z.object({ items: z.array(FeedItem), nextCursor: z.string().nullable() })
export type Feed = z.infer<typeof Feed>
export const LikeState = z.object({ liked: z.boolean(), likes: z.number().int() })

// ---- Reader comments on published works ----
const ReaderCommentBase = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  editedAt: z.iso.datetime({ offset: true }).nullable(),
  author: PublicPerson,
  /** the work's author wrote it */
  byAuthor: z.boolean(),
  /** the viewer may delete it (theirs, or they own the work) */
  canDelete: z.boolean(),
  /** deleted, but kept as a placeholder because people replied to it */
  removed: z.boolean(),
  /** a paragraph comment (P-054): the block it sits beside; null for comments on the whole work */
  blockId: z.string().nullable(),
})
/** A top-level comment and its replies (one level deep). */
export const ReaderComment = ReaderCommentBase.extend({ replies: z.array(ReaderCommentBase) })
export type ReaderComment = z.infer<typeof ReaderComment>
export type ReaderReply = z.infer<typeof ReaderCommentBase>
export const ReaderComments = z.object({
  items: z.array(ReaderComment),
  total: z.number().int(),
  nextCursor: z.string().nullable(),
  /** whether the viewer can post (signed in, not blocked, not muted) */
  canComment: z.boolean(),
})
export const CreateReaderCommentInput = z.object({
  body: z.string().trim().min(1).max(2000),
  parentId: z.uuid().optional(),
  /** a paragraph comment (P-054): the published chapter and the block, given together */
  chapterSlug: z.string().min(1).max(240).optional(),
  blockId: z.string().min(1).max(120).optional(),
})
/** How many paragraph comments each block of a published chapter has (only blocks with any). */
export const ParagraphCommentCounts = z.object({ counts: z.record(z.string(), z.number().int()) })

export const SEARCH_SORTS = ['relevance', 'recent', 'popular'] as const
export const SearchQuery = z.object({
  q: z.string().trim().max(200).default(''),
  category: z.enum(WORK_CATEGORIES).optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
  sort: z.enum(SEARCH_SORTS).default('relevance'),
  page: z.coerce.number().int().min(1).max(50).default(1),
})
export const SearchResults = z.object({
  works: z.array(DiscoveryWork),
  authors: z.array(
    z.object({
      username: z.string(),
      displayName: z.string(),
      avatarSeed: z.string(),
      avatar: AvatarConfig.nullable(),
      bio: z.string().nullable(),
    }),
  ),
  page: z.number().int(),
  hasMore: z.boolean(),
})
export type SearchResults = z.infer<typeof SearchResults>

// ---- Reporting, moderation, blocking (PRD FR-031/032) ----
export const REPORT_CATEGORIES = [
  'abuse',
  'harassment',
  'spam',
  'copyright',
  'impersonation',
  'inappropriate',
  'malicious_links',
  'other',
] as const
export const REPORT_CATEGORY_LABELS: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  abuse: 'Abusive behaviour',
  harassment: 'Harassment',
  spam: 'Spam',
  copyright: 'Copyright infringement',
  impersonation: 'Impersonation',
  inappropriate: 'Inappropriate content',
  malicious_links: 'Malicious links',
  other: 'Something else against the rules',
}
export const ReportInput = z.object({
  target: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('work'),
      publicPath: z.string().max(200).optional(),
      workId: z.uuid().optional(),
    }),
    z.object({ type: z.literal('comment'), commentId: z.uuid() }),
    z.object({ type: z.literal('user'), username: z.string().min(3).max(30) }),
    z.object({ type: z.literal('proposal'), proposalId: z.uuid() }),
    z.object({ type: z.literal('reader_comment'), commentId: z.uuid() }),
  ]),
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().trim().max(2000).default(''),
})
export const MyReport = z.object({
  id: z.uuid(),
  targetType: z.string(),
  summary: z.string(),
  category: z.enum(REPORT_CATEGORIES),
  status: z.enum(['open', 'reviewing', 'actioned', 'dismissed']),
  resolution: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const QueueReport = MyReport.extend({
  targetId: z.string(),
  details: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
  reporter: z.object({ id: z.string(), name: z.string() }),
  subject: z.object({ id: z.string(), name: z.string() }).nullable(),
  priorActions: z.number().int(),
  reviewer: z.string().nullable(),
})
export type QueueReport = z.infer<typeof QueueReport>
export const ResolveReportInput = z.object({
  action: z.enum(['dismiss', 'hide_work', 'remove_comment', 'restrict_account']),
  /** internal: recorded in the audit history */
  reason: z.string().trim().min(3).max(2000),
  /** shown to the reporter */
  resolution: z.string().trim().max(1000).default(''),
  restriction: z
    .object({ kind: z.enum(['suspended', 'muted']), days: z.number().int().min(1).max(365).nullable() })
    .optional(),
})
export const ModerationActionItem = z.object({
  id: z.uuid(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  reason: z.string(),
  moderator: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  reversed: z.boolean(),
  appeal: z.object({ status: z.enum(['open', 'upheld', 'overturned']), decision: z.string() }).nullable(),
})
export const MyModeration = z.object({
  restriction: z
    .object({
      kind: z.enum(['suspended', 'muted']),
      until: z.iso.datetime({ offset: true }).nullable(),
      reason: z.string(),
    })
    .nullable(),
  actions: z.array(ModerationActionItem),
})
export const AppealInput = z.object({ actionId: z.uuid(), message: z.string().trim().min(10).max(2000) })
export const QueueAppeal = z.object({
  id: z.uuid(),
  message: z.string(),
  user: z.object({ id: z.string(), name: z.string() }),
  action: ModerationActionItem,
  createdAt: z.iso.datetime({ offset: true }),
})
export const DecideAppealInput = z.object({
  decision: z.enum(['upheld', 'overturned']),
  note: z.string().trim().min(3).max(1000),
})
export const BlockInput = z.object({ username: z.string().min(3).max(30) })

// ---- "What if" reader polls (P-062) ----
export const PollInput = z.object({
  question: z.string().trim().min(3).max(200),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(4),
  /** days until it closes; null = open until removed */
  closesInDays: z.number().int().min(1).max(60).nullable().default(null),
})
export const Poll = z.object({
  question: z.string(),
  /** vote counts are present once the viewer has voted, the poll has closed, or the viewer is the writer */
  options: z.array(z.object({ label: z.string(), votes: z.number().int().nullable() })),
  total: z.number().int(),
  myVote: z.number().int().nullable(),
  closesAt: z.iso.datetime({ offset: true }).nullable(),
  closed: z.boolean(),
})
export type Poll = z.infer<typeof Poll>
export const VoteInput = z.object({ option: z.number().int().min(0).max(3) })

// ---- Weekly prompts (P-059) ----
export const WeeklyPrompt = z.object({
  title: z.string(),
  body: z.string(),
  /** entries are works with this tag */
  tag: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  entries: z.number().int(),
  recent: z.array(DiscoveryWork),
})
export type WeeklyPrompt = z.infer<typeof WeeklyPrompt>

// ---- Writing streaks and goals (P-055) ----
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const WritingReport = z.object({
  /** the writer's local date */
  day: Day,
  /** words added (or, if negative, removed) by this writer since the last report */
  words: z.number().int().min(-20000).max(20000),
})
export const WritingStats = z.object({
  /** words a day the writer aims for; 0 = no goal */
  goal: z.number().int(),
  today: z.number().int(),
  /** consecutive days with words written, up to today (or yesterday, if today hasn't started yet) */
  streak: z.number().int(),
  best: z.number().int(),
  /** the last seven days, oldest first */
  week: z.array(z.object({ day: Day, words: z.number().int() })),
})
export type WritingStats = z.infer<typeof WritingStats>
export const WritingGoalInput = z.object({ goal: z.number().int().min(0).max(20000) })

// ---- Contribution requests (P-050): "Ask to collaborate" on a published work ----
export const CONTRIBUTION_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn'] as const
export const CreateContributionRequestInput = z.object({
  publicPath: z.string().min(3).max(200),
  message: z.string().trim().max(1000).default(''),
})
export const ContributionRequest = z.object({
  id,
  status: z.enum(CONTRIBUTION_REQUEST_STATUSES),
  message: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  work: z.object({ id, title: z.string(), publicPath: z.string() }),
  requester: PublicPerson,
})
export type ContributionRequest = z.infer<typeof ContributionRequest>
/** Where the signed-in viewer stands with a published work, for the Contribute sheet. */
export const ContributionState = z.object({
  member: z.boolean(),
  pending: z.boolean(),
  openToSuggestions: z.boolean(),
})
export type ContributionState = z.infer<typeof ContributionState>

// ---- Public participation (M6) ----
export const SuggestionInput = z
  .object({
    publicPath: z.string().min(3).max(200),
    /** 'edit' changes a published chapter; 'chapter' offers the next one (story chains, P-061) */
    kind: z.enum(['edit', 'chapter']).default('edit'),
    chapterSlug: z.string().min(1).max(240).optional(),
    title: z.string().trim().min(1).max(200),
    explanation: z.string().trim().max(4000).default(''),
    /** the chapter itself, for kind 'chapter' */
    body: z.string().trim().max(60000).default(''),
  })
  .refine((v) => (v.kind === 'edit' ? !!v.chapterSlug : v.body.length > 0), {
    message: 'An edit needs a chapter; a new chapter needs its text.',
  })

// ---- Plans and entitlements (PRD FR-033/034) ----
export const PlanLimitsSchema = z.object({
  privateWorks: z.number().int().nullable(),
  membersPerWork: z.number().int().nullable(),
  branchesPerWork: z.number().int().nullable(),
  exportFormats: z.array(z.string()),
  aiCreditsPerMonth: z.number().int().nullable(),
})
export const PlanInfo = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  priceMonthly: z.number().int().nullable(),
  currency: z.string(),
  limits: PlanLimitsSchema,
  features: z.array(z.string()),
})
export type PlanInfo = z.infer<typeof PlanInfo>
export const MyPlan = z.object({
  plan: PlanInfo,
  status: z.enum(['free', 'active', 'trialing', 'past_due', 'canceled', 'comped']),
  currentPeriodEnd: z.iso.datetime({ offset: true }).nullable(),
  cancelAtPeriodEnd: z.boolean(),
  usage: z.object({ privateWorks: z.number().int() }),
  /** billing can run disabled (FR-033): then plans can be seen and comped, not bought */
  billingEnabled: z.boolean(),
  invoices: z.array(
    z.object({
      amount: z.number().int(),
      currency: z.string(),
      status: z.string(),
      createdAt: z.string(),
      hostedUrl: z.string().nullable(),
    }),
  ),
})
export type MyPlan = z.infer<typeof MyPlan>

// ---- The writer's dashboard: what's happening around your profile and your work ----
export const DASHBOARD_PERIODS = [7, 30, 90] as const
export const DashboardQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => (DASHBOARD_PERIODS as readonly number[]).includes(d), 'Choose 7, 30 or 90 days')
    .default(30),
})
const Metric = z.object({ current: z.number().int(), previous: z.number().int() })
export const DASHBOARD_METRICS = ['reads', 'likes', 'comments', 'followers', 'saves', 'profileViews'] as const
export const Dashboard = z.object({
  days: z.number().int(),
  profile: z.object({
    displayName: z.string(),
    username: z.string(),
    avatarSeed: z.string(),
    avatar: AvatarConfig.nullable(),
    isPublic: z.boolean(),
    followers: z.number().int(),
    following: z.number().int(),
    publishedWorks: z.number().int(),
    badges: z.number().int(),
  }),
  /** this period and the one before it, for the trend */
  totals: z.object({
    reads: Metric,
    likes: Metric,
    comments: Metric,
    followers: Metric,
    saves: Metric,
    profileViews: Metric,
  }),
  /** one row per day, oldest first, zeros included */
  daily: z.array(
    z.object({
      day: z.string(),
      reads: z.number().int(),
      likes: z.number().int(),
      comments: z.number().int(),
      followers: z.number().int(),
      saves: z.number().int(),
      profileViews: z.number().int(),
    }),
  ),
  /** all-time counts per published work, most-read in the period first */
  works: z.array(
    z.object({
      title: z.string(),
      publicPath: z.string(),
      appWorkId: z.uuid(),
      publishedAt: z.iso.datetime({ offset: true }),
      completed: z.boolean(),
      readsInPeriod: z.number().int(),
      reads: z.number().int(),
      likes: z.number().int(),
      comments: z.number().int(),
      saves: z.number().int(),
      workFollowers: z.number().int(),
    }),
  ),
  /** who did what, newest first: likes, comments, follows. Reads and saves are private, so they're counts only. */
  activity: z.array(
    z.object({
      kind: z.enum(['like', 'comment', 'follow', 'work_follow']),
      at: z.iso.datetime({ offset: true }),
      person: PublicPerson,
      work: z.object({ title: z.string(), publicPath: z.string() }).nullable(),
      excerpt: z.string().nullable(),
      /** a follow you could return */
      followingBack: z.boolean().nullable(),
    }),
  ),
})
export type Dashboard = z.infer<typeof Dashboard>
