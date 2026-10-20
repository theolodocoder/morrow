import type { MyPlan, PlanInfo } from '@morrow/contracts'
import { AppPage } from '@/components/notifications/app-page'
import { SettingsNav } from '@/components/settings/settings-nav'
import { CheckIcon } from '@/components/ui/icons'
import { publicApi } from '@/lib/public-api'
import { serverApi } from '@/lib/server-api'

export const metadata = { title: 'Plan' }
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
const limit = (n: number | null, unit: string) => (n === null ? `Unlimited ${unit}` : `${n} ${unit}`)
const FEATURE: Record<string, string> = {
  advanced_history: 'Advanced history',
  analytics: 'Writing analytics',
  team_admin: 'Team administration',
  audit: 'Audit and reporting',
}

/** Each plan's emblem: the brand's sun, rising higher the more room the plan gives. */
function PlanEmblem({ rank }: { rank: number }) {
  const y = 34 - Math.min(rank, 3) * 6
  return (
    <svg aria-hidden="true" viewBox="0 0 56 40" width="56" height="40" className="text-accent">
      <path d="M4 34h48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
      <circle cx="28" cy={y} r={10 + Math.min(rank, 3) * 1.5} fill="currentColor" opacity=".9" />
      {rank > 0 &&
        Array.from({ length: Math.min(rank, 3) * 2 + 1 }, (_, i) => {
          const a = Math.PI + (Math.PI * (i + 1)) / (Math.min(rank, 3) * 2 + 2)
          const r1 = 15 + Math.min(rank, 3) * 1.5
          return (
            <path
              key={i}
              d={`M${28 + Math.cos(a) * r1} ${y + Math.sin(a) * r1}l${Math.cos(a) * 4} ${Math.sin(a) * 4}`}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )
        })}
      <rect x="0" y="35" width="56" height="5" fill="var(--bg-canvas)" />
    </svg>
  )
}

function PlanCard({ p, current, rank }: { p: PlanInfo; current: boolean; rank: number }) {
  return (
    <li
      className={`relative flex flex-col gap-3 rounded-xl border bg-canvas p-5 transition-shadow hover:shadow-[0_8px_24px_rgb(34_34_31/.08)] ${current ? 'border-action ring-1 ring-[var(--action-primary-bg)]' : 'border-subtle'}`}
    >
      {current && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-action px-2.5 py-0.5 text-[11px] font-medium text-action-fg">
          Your plan
        </span>
      )}
      <PlanEmblem rank={rank} />
      <div>
        <p className="font-display text-[24px] leading-tight text-primary">{p.name}</p>
        <p className="mt-0.5 text-[13px] text-secondary">
          {p.priceMonthly === null ? (
            'Free, always'
          ) : (
            <>
              <span className="font-display text-[20px] text-primary">
                {money(p.priceMonthly, p.currency)}
              </span>{' '}
              a month (planned)
            </>
          )}
        </p>
      </div>
      <p className="text-sm text-secondary">{p.description}</p>
      <ul className="flex flex-col gap-1.5 border-t border-subtle pt-3 text-[13px] text-primary">
        {[
          limit(p.limits.privateWorks, 'private works'),
          limit(p.limits.membersPerWork, 'people per work'),
          limit(p.limits.branchesPerWork, 'branches per work'),
          ...p.features.map((f) => FEATURE[f] ?? f),
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-selected text-success">
              <CheckIcon size={11} />
            </span>
            {line}
          </li>
        ))}
      </ul>
    </li>
  )
}

/** How much of a limit is used, as a ring. */
function UsageRing({ used, cap }: { used: number; cap: number | null }) {
  const share = cap === null ? 0.12 : Math.min(1, used / Math.max(cap, 1))
  const c = 2 * Math.PI * 26
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" width="72" height="72" className="shrink-0 -rotate-90">
      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--bg-hover)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke={share >= 1 ? 'var(--text-danger, #B3261E)' : 'var(--action-primary-bg)'}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * share} ${c}`}
        className="ring-fill"
      />
    </svg>
  )
}

/** Your plan, what you're using, and the plans (FR-033). Billing may be closed: then nothing is for sale. */
export default async function PlanPage() {
  const [mine, all] = await Promise.all([
    serverApi<MyPlan>('/me/plan'),
    publicApi<{ items: PlanInfo[] }>('/plans'),
  ])
  const cap = mine.plan.limits.privateWorks
  return (
    <AppPage title="Settings">
      <SettingsNav current="Plan" />
      <h1 className="font-display text-[22px] leading-tight text-primary">Your plan: {mine.plan.name}</h1>
      <p className="mt-2 text-secondary">
        {mine.status === 'comped'
          ? 'Given to you by the Morrow team.'
          : mine.status === 'past_due'
            ? 'Your last payment failed; your plan continues while it’s retried.'
            : 'Writing, collaborating, publishing and being read are free, with no trial clock.'}
      </p>
      <section
        aria-labelledby="usage"
        className="mt-6 flex items-center gap-5 rounded-xl border border-subtle bg-canvas p-5"
      >
        <UsageRing used={mine.usage.privateWorks} cap={cap} />
        <div className="min-w-0 flex-1">
          <h2 id="usage" className="text-sm font-medium text-primary">
            Private works
          </h2>
          <p className="mt-0.5 font-display text-[22px] text-primary">
            {cap === null ? `${mine.usage.privateWorks} (no limit)` : `${mine.usage.privateWorks} of ${cap}`}
          </p>
          {cap !== null && (
            <div
              className="sr-only"
              role="progressbar"
              aria-label="Private works used"
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={mine.usage.privateWorks}
            />
          )}
          <p className="mt-1 text-[12px] text-secondary">
            Published and link-only works don’t count. Reaching a limit never removes or locks anything you
            have.
          </p>
        </div>
      </section>
      <section aria-labelledby="plans" className="mt-10">
        <h2 id="plans" className="font-display text-[24px] text-primary">
          Plans
        </h2>
        {!mine.billingEnabled && (
          <p className="mt-1 text-[13px] text-secondary">
            Paid plans aren’t on sale yet. Prices shown are what we’re planning.
          </p>
        )}
        <ul className="mt-6 grid gap-5 sm:grid-cols-2">
          {all.items.map((p, i) => (
            <PlanCard key={p.key} p={p} rank={i} current={p.key === mine.plan.key} />
          ))}
        </ul>
      </section>
      {mine.invoices.length > 0 && (
        <section aria-labelledby="billing" className="mt-10">
          <h2 id="billing" className="mb-2 font-medium text-primary">
            Billing history
          </h2>
          <ul className="divide-y divide-subtle border-y border-subtle text-sm">
            {mine.invoices.map((i, n) => (
              <li key={n} className="flex justify-between py-2">
                <span>{new Date(i.createdAt).toLocaleDateString('en')}</span>
                <span>
                  {money(i.amount, i.currency)} · {i.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppPage>
  )
}
