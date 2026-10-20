/**
 * Structured JSON logs. Never log manuscript content, Yjs updates, awareness, tickets or tokens
 * (engineering standards §3.7): callers pass ids, sizes and timings only.
 */
type Fields = Record<string, unknown>
export interface Logger {
  info(f: Fields): void
  warn(f: Fields): void
  error(f: Fields): void
}

export function createLogger(
  service: string,
  write: (line: string) => void = (l) => process.stdout.write(l + '\n'),
): Logger {
  const at = (level: string) => (f: Fields) =>
    write(JSON.stringify({ t: new Date().toISOString(), level, service, ...f }))
  return { info: at('info'), warn: at('warn'), error: at('error') }
}
export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} }
