import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bestOf, streakOf } from '../src/routes/writing.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('writing')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('streaks (P-055)', () => {
  it('counts back from today, or from yesterday before today’s writing starts', () => {
    const days = new Set(['2026-10-17', '2026-10-18', '2026-10-19'])
    expect(streakOf(days, '2026-10-19')).toBe(3)
    expect(streakOf(days, '2026-10-20')).toBe(3) // today not started yet: still alive
    expect(streakOf(days, '2026-10-21')).toBe(0) // a day missed
    expect(bestOf(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'])).toBe(3)
  })

  it('the editor reports words; today, the week, the goal; dates far from today are refused', async () => {
    const ama = await signUp(ctx.app, 'Ama Streak')
    const today = iso(new Date())
    const yesterday = iso(new Date(Date.now() - 86_400_000))
    expect((await ama.call('POST', '/api/v1/me/writing', { day: yesterday, words: 120 })).statusCode).toBe(
      204,
    )
    await ama.call('POST', '/api/v1/me/writing', { day: today, words: 300 })
    await ama.call('POST', '/api/v1/me/writing', { day: today, words: -50 }) // deleting counts down, never below 0
    expect((await ama.call('POST', '/api/v1/me/writing', { day: '2020-01-01', words: 10 })).statusCode).toBe(
      400,
    )
    expect((await ama.call('PUT', '/api/v1/me/writing/goal', { goal: 500 })).statusCode).toBe(200)
    const stats = (await ama.call('GET', `/api/v1/me/writing?day=${today}`)).json() as {
      goal: number
      today: number
      streak: number
      week: { day: string; words: number }[]
    }
    expect(stats).toMatchObject({ goal: 500, today: 250, streak: 2 })
    expect(stats.week.at(-1)).toEqual({ day: today, words: 250 })
    expect(stats.week).toHaveLength(7)
  })
})
