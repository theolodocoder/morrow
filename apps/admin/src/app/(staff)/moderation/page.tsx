import { ModerationConsole } from '@/components/moderation-console'

export const metadata = { title: 'Moderation' }
export default function ModerationPage() {
  return (
    <>
      <h1 className="mb-2 text-[24px] font-semibold">Moderation</h1>
      <p className="mb-6 text-[13px] text-secondary">
        You see only what was reported, as it was then. Every decision is recorded, and you can’t act on your
        own content or reports.
      </p>
      <ModerationConsole />
    </>
  )
}
