import { Suspense } from 'react'
import { ResetPasswordForm } from '../password-forms'
import { AuthSpread } from '@/components/brand/auth-spread'
export const metadata = { title: 'Choose a new password', robots: { index: false } }
export default function ResetPassword() {
  return (
    <AuthSpread state="continuing">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthSpread>
  )
}
