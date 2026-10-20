import { Suspense } from 'react'
import { AuthForm } from '../auth-form'
import { AuthSpread } from '@/components/brand/auth-spread'
export const metadata = { title: 'Sign in' }
export default function SignIn() {
  return (
    <AuthSpread state="continuing">
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthSpread>
  )
}
