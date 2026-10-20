import { SignOut } from '@/components/sign-out'
export default function NoAccess() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <h1 className="text-[24px] font-semibold">No staff access</h1>
        <p className="text-secondary">
          This account isn’t staff. Staff roles are granted by an operator, not here.
        </p>
        <SignOut />
      </div>
    </main>
  )
}
