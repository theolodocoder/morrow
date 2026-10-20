/**
 * Outgoing email behind one interface, so the provider (T-003, still Open) is a single swap.
 * Development and tests log messages; production without a provider sends nothing and says so —
 * invitations still work through their copyable link.
 */
export interface EmailMessage {
  to: string
  subject: string
  text: string
}
export interface EmailSender {
  send(message: EmailMessage): Promise<void>
  /** false when no provider is configured: callers must not record mail as sent */
  readonly delivers?: boolean
}

export function devEmailSender(
  log: (line: string) => void = (l) => console.warn(l),
): EmailSender & { outbox: EmailMessage[] } {
  const outbox: EmailMessage[] = []
  return {
    outbox,
    async send(m) {
      outbox.push(m)
      log(`[dev email] to=${m.to} subject="${m.subject}"\n${m.text}`)
    },
  }
}

export const disabledEmailSender: EmailSender = {
  delivers: false,
  async send() {
    /* no provider configured (T-003); the invite link is shown to the inviter instead */
  },
}

/**
 * Resend (https://resend.com): one HTTPS call per message. Failures throw, so callers that record delivery can retry;
 * auth emails swallow them (a failed send must not reveal whether an account exists).
 */
export function resendEmailSender(apiKey: string, from: string): EmailSender {
  return {
    delivers: true,
    async send(m) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`email provider refused the message (${res.status})`)
    },
  }
}
