import { createHmac } from 'node:crypto'

/** RFC 6238 TOTP (SHA-1, 6 digits, 30s), for tests that sign in like a person with an authenticator app. */
export function totp(base32Secret: string, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of base32Secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
export const secretFromUri = (uri: string) => new URL(uri).searchParams.get('secret')!
