import { Shell } from '@/components/shell/shell'

/** A page inside the app shell with a comfortable reading width (Activity, Settings, and their sub-pages). */
export async function AppPage({
  children,
  title,
  back,
}: {
  children: React.ReactNode
  /** the mobile top bar's title */
  title?: string
  /** for pages one level down (e.g. Reports under Settings) */
  back?: { href: string; label: string }
}) {
  return (
    <Shell {...(title ? { title } : {})} {...(back ? { back } : {})}>
      <main id="main" className="mx-auto max-w-2xl px-4 py-8 sm:px-8 md:py-10">
        {children}
      </main>
    </Shell>
  )
}
