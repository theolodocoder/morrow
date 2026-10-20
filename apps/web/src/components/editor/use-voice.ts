'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Collab, VoiceMessage } from './use-collab'

/**
 * Talk while you write (P-064): the chapter's voice room, over WebRTC. Collab relays the signalling on the chapter's
 * own connection (so only people who can open the chapter can join); audio goes browser to browser and is never
 * recorded. You join muted; the microphone is asked for only when you join.
 *
 * ICE servers come from NEXT_PUBLIC_ICE_SERVERS (JSON, as RTCConfiguration.iceServers). With none, calls work on
 * localhost and simple networks; across the internet, production needs a TURN server (e.g. coturn). The room is a
 * full mesh, capped at 8 speakers by collab; bigger rooms need an SFU (e.g. LiveKit).
 */
export type VoicePeerState = RTCPeerConnectionState | 'new'
export interface VoicePeerView {
  peerId: string
  userId: string
  muted: boolean
  me: boolean
  state: VoicePeerState
  speaking: boolean
}
export type VoiceStatus = 'idle' | 'joining' | 'joined' | 'denied' | 'full' | 'unsupported'

function iceServers(): RTCIceServer[] {
  try {
    const parsed = JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : []
  } catch {
    return []
  }
}

/** Above this level (0–1 RMS) someone counts as speaking. */
const SPEAKING = 0.04

export function useVoice(collab: Collab | null) {
  const [roster, setRoster] = useState<{
    you: string | null
    peers: { peerId: string; userId: string; muted: boolean }[]
  }>({ you: null, peers: [] })
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(true)
  const [states, setStates] = useState<Record<string, VoicePeerState>>({})
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})

  const local = useRef<MediaStream | null>(null)
  const pcs = useRef(new Map<string, RTCPeerConnection>())
  const audio = useRef(new Map<string, HTMLAudioElement>())
  const meters = useRef(new Map<string, AnalyserNode>())
  const ctx = useRef<AudioContext | null>(null)
  const you = useRef<string | null>(null)

  const meter = useCallback((peerId: string, stream: MediaStream) => {
    try {
      ctx.current ??= new AudioContext()
      const source = ctx.current.createMediaStreamSource(stream)
      const analyser = ctx.current.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser) // measured only, never played back through here
      meters.current.set(peerId, analyser)
    } catch {
      // no Web Audio: no speaking rings, the call still works
    }
  }, [])

  const close = useCallback((peerId: string) => {
    pcs.current.get(peerId)?.close()
    pcs.current.delete(peerId)
    audio.current.get(peerId)?.remove()
    audio.current.delete(peerId)
    meters.current.delete(peerId)
    setStates(({ [peerId]: _gone, ...rest }) => rest)
  }, [])

  const connect = useCallback(
    (peerId: string) => {
      if (!collab || pcs.current.has(peerId) || !local.current) return pcs.current.get(peerId)
      const pc = new RTCPeerConnection({ iceServers: iceServers() })
      pcs.current.set(peerId, pc)
      local.current.getTracks().forEach((t) => pc.addTrack(t, local.current!))
      pc.onicecandidate = (e) => {
        if (e.candidate)
          collab.voice.send({ op: 'signal', to: peerId, data: { candidate: e.candidate.toJSON() } })
      }
      pc.onconnectionstatechange = () => setStates((s) => ({ ...s, [peerId]: pc.connectionState }))
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track])
        let el = audio.current.get(peerId)
        if (!el) {
          el = document.createElement('audio')
          el.autoplay = true
          el.dataset.voicePeer = peerId
          el.hidden = true
          document.body.appendChild(el)
          audio.current.set(peerId, el)
        }
        el.srcObject = stream
        void el.play().catch(() => {})
        meter(peerId, stream)
      }
      setStates((s) => ({ ...s, [peerId]: 'new' }))
      return pc
    },
    [collab, meter],
  )

  // Signalling: who's here, offers/answers/candidates. The peer with the smaller id makes the offer (no glare).
  useEffect(() => {
    if (!collab) return
    return collab.voice.on(async (m: VoiceMessage) => {
      if (m.op === 'roster') {
        you.current = m.you
        setRoster({ you: m.you, peers: m.peers })
        if (!m.you) return
        const present = new Set(m.peers.map((p) => p.peerId))
        for (const id of [...pcs.current.keys()]) if (!present.has(id)) close(id)
        for (const p of m.peers) {
          if (p.peerId === m.you || pcs.current.has(p.peerId) || m.you > p.peerId) continue
          const pc = connect(p.peerId)
          if (!pc) continue
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          collab.voice.send({ op: 'signal', to: p.peerId, data: { sdp: pc.localDescription!.toJSON() } })
        }
      } else if (m.op === 'full') {
        setStatus('full')
        stopLocal()
      } else if (m.op === 'signal' && you.current) {
        const data = m.data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
        const pc = pcs.current.get(m.from) ?? connect(m.from)
        if (!pc) return
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp)
          if (data.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer())
            collab.voice.send({ op: 'signal', to: m.from, data: { sdp: pc.localDescription!.toJSON() } })
          }
        } else if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {})
      }
    })
  }, [collab, connect, close])

  // Speaking rings: sample levels ten times a second, and only re-render when someone starts or stops.
  useEffect(() => {
    if (status !== 'joined') return
    const buf = new Float32Array(512)
    const t = window.setInterval(() => {
      const next: Record<string, boolean> = {}
      for (const [id, a] of meters.current) {
        a.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        next[id] = Math.sqrt(sum / buf.length) > SPEAKING
      }
      setSpeaking((prev) =>
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([k, v]) => prev[k] === v)
          ? prev
          : next,
      )
    }, 100)
    return () => window.clearInterval(t)
  }, [status])

  function stopLocal() {
    local.current?.getTracks().forEach((t) => t.stop())
    local.current = null
  }

  const leave = useCallback(() => {
    collab?.voice.send({ op: 'leave' })
    for (const id of [...pcs.current.keys()]) close(id)
    stopLocal()
    void ctx.current?.close().catch(() => {})
    ctx.current = null
    meters.current.clear()
    setMuted(true)
    setStatus('idle')
  }, [collab, close])

  const join = useCallback(async () => {
    if (!collab) return
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined')
      return setStatus('unsupported')
    setStatus('joining')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      stream.getAudioTracks().forEach((t) => (t.enabled = false)) // joined muted
      local.current = stream
      meter('me', stream)
      setMuted(true)
      setStatus('joined')
      collab.voice.send({ op: 'join' })
    } catch {
      setStatus('denied')
    }
  }, [collab, meter])

  const toggleMute = useCallback(() => {
    if (!local.current || !collab) return
    const next = !muted
    local.current.getAudioTracks().forEach((t) => (t.enabled = !next))
    setMuted(next)
    collab.voice.send({ op: 'mute', muted: next })
  }, [collab, muted])

  // Leaving the page leaves the room (collab also drops the connection when it closes).
  useEffect(() => {
    const bye = () => {
      if (local.current) leave()
    }
    window.addEventListener('pagehide', bye)
    return () => {
      window.removeEventListener('pagehide', bye)
      bye()
    }
  }, [leave])

  const peers: VoicePeerView[] = roster.peers.map((p) => {
    const me = p.peerId === roster.you
    return {
      ...p,
      me,
      state: me ? 'connected' : (states[p.peerId] ?? 'new'),
      speaking: me ? !muted && !!speaking.me : !p.muted && !!speaking[p.peerId],
    }
  })
  return { peers, status, muted, join, leave, toggleMute }
}
