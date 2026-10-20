/**
 * Voice rooms (P-064): talk while you write. One room per chapter document; audio flows browser to browser (WebRTC),
 * and collab only carries the signalling (offers, answers, ICE candidates) over the chapter's existing, already
 * authorized connection. So:
 * - you can only join, see or signal a room for a document you're connected to (anyone who can read it may join);
 * - every relayed message carries the sender's *verified* user id from the connection, never a client claim;
 * - a message only ever reaches a peer in the same room of the same document;
 * - two people where either has blocked the other never see or signal each other.
 *
 * Limits: a full mesh (every speaker sends to every other) works for small rooms, so a room holds at most
 * `MAX_SPEAKERS`. Bigger rooms need an SFU (e.g. LiveKit). Across the internet, most networks also need a TURN
 * server (e.g. coturn) in the browser's ICE configuration; without one, calls work on localhost and simple networks.
 * Nothing is recorded: audio never passes through Morrow's servers.
 */
export const MAX_SPEAKERS = 8

/** What a connection in a room is: its peer id (unique per connection), its verified user, and whether it's muted. */
export interface VoicePeer {
  peerId: string
  userId: string
  muted: boolean
}
interface Member extends VoicePeer {
  send: (message: string) => void
}

/** Client → server. Anything else is ignored. */
export type VoiceClientMessage =
  | { v: 1; type: 'voice'; op: 'join' }
  | { v: 1; type: 'voice'; op: 'leave' }
  | { v: 1; type: 'voice'; op: 'mute'; muted: boolean }
  | { v: 1; type: 'voice'; op: 'signal'; to: string; data: unknown }

/** Server → client. */
export type VoiceServerMessage =
  | { v: 1; type: 'voice'; op: 'roster'; you: string | null; peers: VoicePeer[] }
  | { v: 1; type: 'voice'; op: 'full'; max: number }
  | { v: 1; type: 'voice'; op: 'signal'; from: string; fromUserId: string; data: unknown }

/** Largest signalling payload relayed (an SDP offer is a few KB; anything bigger isn't one). */
const MAX_SIGNAL_BYTES = 64 * 1024

export function parseVoiceMessage(raw: string): VoiceClientMessage | null {
  if (raw.length > MAX_SIGNAL_BYTES) return null
  let m: unknown
  try {
    m = JSON.parse(raw)
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  const x = m as Record<string, unknown>
  if (x.v !== 1 || x.type !== 'voice') return null
  if (x.op === 'join' || x.op === 'leave') return { v: 1, type: 'voice', op: x.op }
  if (x.op === 'mute' && typeof x.muted === 'boolean')
    return { v: 1, type: 'voice', op: 'mute', muted: x.muted }
  if (
    x.op === 'signal' &&
    typeof x.to === 'string' &&
    x.to.length <= 100 &&
    x.data &&
    typeof x.data === 'object'
  )
    return { v: 1, type: 'voice', op: 'signal', to: x.to, data: x.data }
  return null
}

export function createVoiceRooms(opts: {
  /** whether either of two users has blocked the other */
  blocked: (a: string, b: string) => Promise<boolean>
}) {
  /** documentName → peerId → member */
  const rooms = new Map<string, Map<string, Member>>()
  /** documentName → every connection on that document (members or not), so non-members see who's talking */
  const watchers = new Map<string, Map<string, { userId: string; send: (m: string) => void }>>()

  const json = (m: VoiceServerMessage) => JSON.stringify(m)

  async function rosterFor(documentName: string, viewer: { userId: string }, you: string | null) {
    const peers: VoicePeer[] = []
    for (const p of rooms.get(documentName)?.values() ?? []) {
      if (p.userId !== viewer.userId && (await opts.blocked(viewer.userId, p.userId))) continue
      peers.push({ peerId: p.peerId, userId: p.userId, muted: p.muted })
    }
    return json({ v: 1, type: 'voice', op: 'roster', you, peers })
  }

  /** Everyone on the document hears the new roster (members see their own peer id as `you`). */
  async function announce(documentName: string) {
    const room = rooms.get(documentName)
    for (const [peerId, w] of watchers.get(documentName) ?? []) {
      w.send(await rosterFor(documentName, w, room?.has(peerId) ? peerId : null))
    }
  }

  return {
    /** A connection opened on a document: it can now see the room (and join it). */
    async watch(documentName: string, peerId: string, userId: string, send: (m: string) => void) {
      const w = watchers.get(documentName) ?? new Map()
      w.set(peerId, { userId, send })
      watchers.set(documentName, w)
      send(await rosterFor(documentName, { userId }, null))
    },

    /** Handle one message from a connection (its identity comes from the connection, not the message). */
    async handle(
      documentName: string,
      peerId: string,
      userId: string,
      send: (m: string) => void,
      msg: VoiceClientMessage,
    ) {
      const room = rooms.get(documentName) ?? new Map<string, Member>()
      if (msg.op === 'join') {
        if (room.has(peerId)) return
        if (room.size >= MAX_SPEAKERS)
          return send(json({ v: 1, type: 'voice', op: 'full', max: MAX_SPEAKERS }))
        // joined muted: the microphone opens only when the person chooses to speak
        room.set(peerId, { peerId, userId, muted: true, send })
        rooms.set(documentName, room)
        return announce(documentName)
      }
      const me = room.get(peerId)
      if (!me) return // only members may leave, mute or signal
      if (msg.op === 'leave') return this.drop(documentName, peerId)
      if (msg.op === 'mute') {
        me.muted = msg.muted
        return announce(documentName)
      }
      // signal: only to a member of this same room, and never between people who've blocked each other
      const target = room.get(msg.to)
      if (!target || target.peerId === peerId) return
      if (await opts.blocked(userId, target.userId)) return
      target.send(
        json({ v: 1, type: 'voice', op: 'signal', from: peerId, fromUserId: userId, data: msg.data }),
      )
    },

    /** A connection closed (or left): out of the room and the watcher list. */
    async drop(documentName: string, peerId: string, closed = false) {
      const room = rooms.get(documentName)
      const was = room?.delete(peerId) ?? false
      if (room && room.size === 0) rooms.delete(documentName)
      if (closed) {
        const w = watchers.get(documentName)
        w?.delete(peerId)
        if (w && w.size === 0) watchers.delete(documentName)
      }
      if (was) await announce(documentName)
    },

    /** For tests and diagnostics. */
    members: (documentName: string) =>
      [...(rooms.get(documentName)?.values() ?? [])].map(({ send: _s, ...p }) => p),
  }
}
export type VoiceRooms = ReturnType<typeof createVoiceRooms>
