import { Suspense } from 'react'
import { AuthForm } from '../auth-form'
import { AuthSpread } from '@/components/brand/auth-spread'
export const metadata = { title: 'Create an account' }
export default function SignUp() {
  return (
    <AuthSpread state="beginning">
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthSpread>
  )
}
