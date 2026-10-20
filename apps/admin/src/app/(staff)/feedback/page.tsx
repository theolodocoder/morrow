import { FeedbackInbox } from '@/components/feedback-inbox'
export const metadata = { title: 'Feedback' }
export default function FeedbackPage() {
  return (
    <>
      <h1 className="mb-4 text-[24px] font-semibold">Beta feedback</h1>
      <FeedbackInbox />
    </>
  )
}
