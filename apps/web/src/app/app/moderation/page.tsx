import { redirect } from 'next/navigation'

/** Moderation lives in the admin app (separate origin, two-factor required). */
export default function ModerationMoved() {
  redirect(`${process.env.ADMIN_PUBLIC_URL ?? 'http://localhost:3002'}/moderation`)
}
