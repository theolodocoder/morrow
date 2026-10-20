import { describe, expect, it } from 'vitest'
import { MAX_SPEAKERS, createVoiceRooms, parseVoiceMessage, type VoiceServerMessage } from '../src/voice.ts'

/** A fake connection: records what the server sent it. */
function conn() {
  const got: VoiceServerMessage[] = []
  return { got, send: (m: string) => got.push(JSON.parse(m) as VoiceServerMessage) }
}
const join = { v: 1, type: 'voice', op: 'join' } as const
const lastRoster = (c: ReturnType<typeof conn>) =>
  [...c.got].reverse().find((m) => m.op === 'roster') as Extract<VoiceServerMessage, { op: 'roster' }>

describe('voice rooms: signalling relay (P-064)', () => {
  it('parses only well-formed voice messages', () => {
    expect(parseVoiceMessage('{"v":1,"type":"voice","op":"join"}')).toEqual(join)
    expect(parseVoiceMessage('{"v":1,"type":"voice","op":"mute","muted":"yes"}')).toBeNull()
    expect(parseVoiceMessage('{"v":1,"type":"voice","op":"signal","to":"b","data":"x"}')).toBeNull()
    expect(parseVoiceMessage('{"type":"snapshot_created"}')).toBeNull()
    expect(parseVoiceMessage('not json')).toBeNull()
    expect(
      parseVoiceMessage(`{"v":1,"type":"voice","op":"signal","to":"b","data":{"x":"${'a'.repeat(70000)}"}}`),
    ).toBeNull()
  })

  it('join, roster for everyone on the chapter, muted by default; signals reach only the addressed member', async () => {
    const rooms = createVoiceRooms({ blocked: async () => false })
    const a = conn(),
      b = conn(),
      watcher = conn(),
      elsewhere = conn()
    await rooms.watch('doc1', 'pa', 'ama', a.send)
    await rooms.watch('doc1', 'pb', 'bo', b.send)
    await rooms.watch('doc1', 'pw', 'cy', watcher.send)
    await rooms.watch('doc2', 'px', 'dee', elsewhere.send)
    await rooms.handle('doc1', 'pa', 'ama', a.send, join)
    await rooms.handle('doc1', 'pb', 'bo', b.send, join)

    expect(lastRoster(a)).toMatchObject({
      you: 'pa',
      peers: [{ peerId: 'pa', userId: 'ama', muted: true }, { peerId: 'pb' }],
    })
    expect(lastRoster(watcher)).toMatchObject({ you: null }) // sees who's talking without being in the room
    expect(lastRoster(watcher).peers).toHaveLength(2)
    expect(lastRoster(elsewhere).peers).toHaveLength(0) // another chapter's room is invisible

    await rooms.handle('doc1', 'pa', 'ama', a.send, {
      v: 1,
      type: 'voice',
      op: 'signal',
      to: 'pb',
      data: { sdp: 'offer' },
    })
    expect(b.got.at(-1)).toEqual({
      v: 1,
      type: 'voice',
      op: 'signal',
      from: 'pa',
      fromUserId: 'ama',
      data: { sdp: 'offer' },
    })

    // a watcher who hasn't joined can't signal anyone; nor can anyone reach a peer in another document
    const before = b.got.length
    await rooms.handle('doc1', 'pw', 'cy', watcher.send, {
      v: 1,
      type: 'voice',
      op: 'signal',
      to: 'pb',
      data: { sdp: 'x' },
    })
    await rooms.handle('doc1', 'pa', 'ama', a.send, {
      v: 1,
      type: 'voice',
      op: 'signal',
      to: 'px',
      data: { sdp: 'x' },
    })
    expect(b.got.length).toBe(before)
    expect(elsewhere.got.every((m) => m.op === 'roster')).toBe(true)

    await rooms.handle('doc1', 'pa', 'ama', a.send, { v: 1, type: 'voice', op: 'mute', muted: false })
    expect(lastRoster(b).peers.find((p) => p.peerId === 'pa')?.muted).toBe(false)

    await rooms.drop('doc1', 'pa', true)
    expect(lastRoster(b).peers.map((p) => p.peerId)).toEqual(['pb'])
  })

  it('a room holds at most MAX_SPEAKERS; blocked pairs never see or signal each other', async () => {
    const rooms = createVoiceRooms({ blocked: async (x, y) => [x, y].sort().join() === 'ama,troll' })
    const conns = Array.from({ length: MAX_SPEAKERS + 1 }, () => conn())
    for (let i = 0; i <= MAX_SPEAKERS; i++) {
      const c = conns[i]!
      await rooms.watch('doc', `p${i}`, i === 0 ? 'ama' : i === 1 ? 'troll' : `u${i}`, c.send)
      await rooms.handle('doc', `p${i}`, i === 0 ? 'ama' : i === 1 ? 'troll' : `u${i}`, c.send, join)
    }
    expect(rooms.members('doc')).toHaveLength(MAX_SPEAKERS)
    expect(conns[MAX_SPEAKERS]!.got.at(-1)).toEqual({ v: 1, type: 'voice', op: 'full', max: MAX_SPEAKERS })

    expect(lastRoster(conns[0]!).peers.map((p) => p.userId)).not.toContain('troll')
    expect(lastRoster(conns[1]!).peers.map((p) => p.userId)).not.toContain('ama')
    const before = conns[0]!.got.length
    await rooms.handle('doc', 'p1', 'troll', conns[1]!.send, {
      v: 1,
      type: 'voice',
      op: 'signal',
      to: 'p0',
      data: { sdp: 'x' },
    })
    expect(conns[0]!.got.length).toBe(before)
  })
})
