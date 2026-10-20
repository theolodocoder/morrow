import { ForgotPasswordForm } from '../password-forms'
import { AuthSpread } from '@/components/brand/auth-spread'
export const metadata = { title: 'Forgot password' }
export default function ForgotPassword() {
  return (
    <AuthSpread state="continuing">
      <ForgotPasswordForm />
    </AuthSpread>
  )
}
