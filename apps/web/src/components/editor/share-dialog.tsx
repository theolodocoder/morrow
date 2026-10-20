'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Form,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Button as AriaButton,
} from 'react-aria-components'
import type { CreatedInvitation, Invitation, Member } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextField } from '@/components/ui/text-field'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'
import { ChevronDownIcon } from '@/components/ui/icons'

type AssignableRole = 'editor' | 'collaborator' | 'contributor' | 'viewer'
/** Plain-language roles (design system §9: MemberManager). */
const ROLES: { id: AssignableRole; label: string; description: string }[] = [
  { id: 'editor', label: 'Editor', description: 'Can write and edit the manuscript with you.' },
  {
    id: 'collaborator',
    label: 'Collaborator',
    description: 'Writes directly when the work’s collaboration mode allows; otherwise proposes changes.',
  },
  {
    id: 'contributor',
    label: 'Contributor',
    description: 'Can read and, later, propose changes for you to review.',
  },
  { id: 'viewer', label: 'Reader', description: 'Can read the manuscript. Can’t change anything.' },
]
const ROLE_LABEL: Record<Member['role'], string> = {
  owner: 'Owner',
  editor: 'Editor',
  collaborator: 'Collaborator',
  contributor: 'Contributor',
  viewer: 'Reader',
}

export function ShareDialog({
  workId,
  workTitle,
  canManage,
  meId,
  isOpen,
  onOpenChange,
}: {
  workId: string
  workTitle: string
  canManage: boolean
  meId: string
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>([])
  const [pending, setPending] = useState<Invitation[]>([])
  const [created, setCreated] = useState<CreatedInvitation | null>(null)
  const [role, setRole] = useState<AssignableRole>('editor')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setMembers((await api<{ items: Member[] }>(`/works/${workId}/members`)).items)
    if (canManage) setPending((await api<{ items: Invitation[] }>(`/works/${workId}/invitations`)).items)
  }, [workId, canManage])
  useEffect(() => {
    if (isOpen) {
      setCreated(null)
      setError(null)
      void load()
    }
  }, [isOpen, load])

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await load()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    }
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const email = String(new FormData(form).get('email') ?? '')
    await run(async () => {
      setCreated(
        await api<CreatedInvitation>(`/works/${workId}/invitations`, {
          method: 'POST',
          body: { email, role },
        }),
      )
      setCopied(false)
      form.reset()
    })
  }

  return (
    <Dialog title={`Share “${workTitle}”`} isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="flex max-h-[70dvh] flex-col gap-6 overflow-y-auto">
        {error && <InlineAlert>{error}</InlineAlert>}

        {canManage && (
          <Form onSubmit={invite} className="flex flex-col gap-3">
            <TextField
              name="email"
              type="email"
              label="Invite by email"
              isRequired
              autoFocus
              placeholder="name@example.com"
            />
            <RoleSelect value={role} onChange={setRole} />
            <Button type="submit" variant="primary">
              Create invitation
            </Button>
          </Form>
        )}

        {created && (
          <div className="rounded-sm border border-subtle bg-app p-3" role="status">
            <p className="text-sm text-primary">Invitation ready for {created.email}.</p>
            <p className="mt-1 text-[13px] text-secondary">
              Send them this link. It works once and expires in 7 days.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                value={created.inviteUrl}
                aria-label="Invitation link"
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-sm border border-control bg-canvas px-2 font-mono text-[12px] text-primary"
              />
              <Button
                size="md"
                variant="secondary"
                onPress={async () => {
                  await navigator.clipboard.writeText(created.inviteUrl)
                  setCopied(true)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}

        <section aria-label="People with access">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
            People with access
          </p>
          <ul className="divide-y divide-subtle border-y border-subtle">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-primary">
                    {m.name}
                    {m.userId === meId ? ' (you)' : ''}
                  </p>
                  {m.email && <p className="truncate text-[12px] text-tertiary">{m.email}</p>}
                </div>
                {canManage && m.role !== 'owner' ? (
                  <>
                    <RoleSelect
                      compact
                      label={`Role for ${m.name}`}
                      value={m.role as AssignableRole}
                      onChange={(r) =>
                        void run(() =>
                          api(`/works/${workId}/members/${m.userId}`, { method: 'PATCH', body: { role: r } }),
                        )
                      }
                    />
                    <Button
                      size="sm"
                      variant="quiet"
                      aria-label={`Remove ${m.name}`}
                      onPress={() =>
                        void run(() => api(`/works/${workId}/members/${m.userId}`, { method: 'DELETE' }))
                      }
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <span className="text-[13px] text-secondary">{ROLE_LABEL[m.role]}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {canManage && pending.length > 0 && (
          <section aria-label="Pending invitations">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
              Pending invitations
            </p>
            <ul className="divide-y divide-subtle border-y border-subtle">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-sm text-primary">{i.email}</p>
                  <span className="text-[13px] text-secondary">{ROLE_LABEL[i.role]}</span>
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Revoke invitation for ${i.email}`}
                    onPress={() => void run(() => api(`/invitations/${i.id}`, { method: 'DELETE' }))}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex justify-end">
          <Button variant="quiet" onPress={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function RoleSelect({
  value,
  onChange,
  compact,
  label = 'Role',
}: {
  value: AssignableRole
  onChange: (r: AssignableRole) => void
  compact?: boolean
  label?: string
}) {
  return (
    <Select
      selectedKey={value}
      onSelectionChange={(k) => onChange(k as AssignableRole)}
      className="flex flex-col gap-1.5"
    >
      <Label className={compact ? 'sr-only' : 'text-sm font-medium text-primary'}>{label}</Label>
      <AriaButton
        className={`flex items-center justify-between gap-2 rounded-sm border border-control bg-canvas px-3 text-left text-primary outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus ${compact ? 'h-8 text-[13px]' : 'h-10 text-base'}`}
      >
        <SelectValue />
        <ChevronDownIcon size={16} className="text-tertiary" />
      </AriaButton>
      <Popover className="min-w-[var(--trigger-width)] rounded-md border border-subtle bg-raised p-1 shadow-[0_6px_16px_rgb(34_34_31/.08)]">
        <ListBox className="outline-none">
          {ROLES.map((r) => (
            <ListBoxItem
              key={r.id}
              id={r.id}
              textValue={r.label}
              className="cursor-default rounded-sm px-3 py-2 outline-none data-[focused]:bg-hover data-[selected]:bg-selected"
            >
              <span className="block text-sm font-medium text-primary">{r.label}</span>
              {!compact && <span className="block text-[12px] text-secondary">{r.description}</span>}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  )
}
