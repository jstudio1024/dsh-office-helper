import { describe, expect, it } from 'vitest'
import { formatDuration, getDayKey, initWorkStart, shouldRest, loadThresholdHours, saveThresholdHours, DEFAULT_REST_THRESHOLD_HOURS, getTodayEarliestSession, isSameDay, getEarliestMessageTimeFromConversation, extractAllMessageTimes, recordFirstInteraction, getFirstInteraction, recordActivity, getLastActivity, getIdleDuration, isIdle, loadIdleThresholdMinutes, saveIdleThresholdMinutes, loadDailyStats, updateDailyStats, accumulateWorkTime, getRecentDays, loadWaterState, saveWaterState, loadWaterIntervalMinutes, saveWaterIntervalMinutes, loadWaterGoalCups, saveWaterGoalCups, shouldRemindWater, markCupDrunk, DEFAULT_WATER_INTERVAL_MINUTES, DEFAULT_WATER_GOAL_CUPS } from '../src/work-time.ts'

class MockStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number { return this.store.size }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null }
  getItem(key: string): string | null { return this.store.get(key) ?? null }
  setItem(key: string, value: string): void { this.store.set(key, value) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
}

describe('getDayKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    const d = new Date(2026, 7, 15) // 2026-08-15
    expect(getDayKey(d)).toBe('2026-08-15')
  })

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5) // 2026-01-05
    expect(getDayKey(d)).toBe('2026-01-05')
  })
})

describe('initWorkStart', () => {
  it('creates a new record when storage is empty', () => {
    const storage = new MockStorage()
    const now = new Date(2026, 7, 15, 10, 0, 0) // 2026-08-15 10:00:00
    const result = initWorkStart(now, storage)
    expect(result).toBe(now.getTime())
    const saved = storage.getItem('dsh-office-helper:work-start')
    expect(saved).not.toBeNull()
    const parsed = JSON.parse(saved!)
    expect(parsed.day).toBe('2026-08-15')
    expect(parsed.ts).toBe(now.getTime())
  })

  it('returns existing record for the same day', () => {
    const storage = new MockStorage()
    const morning = new Date(2026, 7, 15, 9, 0, 0)
    initWorkStart(morning, storage)
    const afternoon = new Date(2026, 7, 15, 14, 0, 0)
    const result = initWorkStart(afternoon, storage)
    expect(result).toBe(morning.getTime())
  })

  it('creates new record when day changes', () => {
    const storage = new MockStorage()
    const day1 = new Date(2026, 7, 15, 9, 0, 0)
    initWorkStart(day1, storage)
    const day2 = new Date(2026, 7, 16, 8, 0, 0)
    const result = initWorkStart(day2, storage)
    expect(result).toBe(day2.getTime())
    const saved = JSON.parse(storage.getItem('dsh-office-helper:work-start')!)
    expect(saved.day).toBe('2026-08-16')
  })

  it('handles corrupted storage gracefully', () => {
    const storage = new MockStorage()
    storage.setItem('dsh-office-helper:work-start', 'invalid-json')
    const now = new Date(2026, 7, 15, 10, 0, 0)
    const result = initWorkStart(now, storage)
    expect(result).toBe(now.getTime())
  })
})

describe('formatDuration', () => {
  it('shows "刚刚开始" for zero or negative duration', () => {
    expect(formatDuration(0)).toBe('刚刚开始')
    expect(formatDuration(-1000)).toBe('刚刚开始')
  })

  it('shows minutes only when less than an hour', () => {
    expect(formatDuration(45 * 60 * 1000)).toBe('45分钟')
    expect(formatDuration(5 * 60 * 1000)).toBe('5分钟')
  })

  it('shows hours only when minutes are zero', () => {
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe('2小时')
  })

  it('shows both hours and minutes', () => {
    expect(formatDuration(2 * 3600 * 1000 + 35 * 60 * 1000)).toBe('2小时35分钟')
  })

  it('handles exactly one hour', () => {
    expect(formatDuration(3600 * 1000)).toBe('1小时')
  })

  it('handles one minute', () => {
    expect(formatDuration(60 * 1000)).toBe('1分钟')
  })
})

describe('shouldRest', () => {
  const base = new Date(2026, 7, 15, 9, 0, 0).getTime() // 09:00

  it('returns false when elapsed time is below threshold', () => {
    const now = base + 3.5 * 3600 * 1000 // 12:30, 3.5 hours
    expect(shouldRest(base, now, 4)).toBe(false)
  })

  it('returns true when elapsed time exceeds threshold', () => {
    const now = base + 4.5 * 3600 * 1000 // 13:30, 4.5 hours
    expect(shouldRest(base, now, 4)).toBe(true)
  })

  it('returns true exactly at threshold', () => {
    const now = base + 4 * 3600 * 1000 // 13:00, exactly 4 hours
    expect(shouldRest(base, now, 4)).toBe(true)
  })

  it('handles custom threshold', () => {
    const now = base + 2.5 * 3600 * 1000 // 11:30, 2.5 hours
    expect(shouldRest(base, now, 2)).toBe(true)
    expect(shouldRest(base, now, 3)).toBe(false)
  })

  it('handles zero or negative elapsed time', () => {
    expect(shouldRest(base, base, 4)).toBe(false)
    expect(shouldRest(base, base - 1000, 4)).toBe(false)
  })
})

describe('loadThresholdHours / saveThresholdHours', () => {
  it('returns default when storage is empty', () => {
    const storage = new MockStorage()
    expect(loadThresholdHours(storage)).toBe(DEFAULT_REST_THRESHOLD_HOURS)
  })

  it('returns saved value from storage', () => {
    const storage = new MockStorage()
    saveThresholdHours(6, storage)
    expect(loadThresholdHours(storage)).toBe(6)
  })

  it('ignores invalid stored values and returns default', () => {
    const storage = new MockStorage()
    storage.setItem('dsh-office-helper:rest-threshold-hours', 'invalid')
    expect(loadThresholdHours(storage)).toBe(DEFAULT_REST_THRESHOLD_HOURS)
  })

  it('ignores non-positive stored values', () => {
    const storage = new MockStorage()
    storage.setItem('dsh-office-helper:rest-threshold-hours', '0')
    expect(loadThresholdHours(storage)).toBe(DEFAULT_REST_THRESHOLD_HOURS)
  })

  it('supports decimal threshold', () => {
    const storage = new MockStorage()
    saveThresholdHours(2.5, storage)
    expect(loadThresholdHours(storage)).toBe(2.5)
  })
})

describe('getTodayEarliestSession', () => {
  const today = new Date(2026, 7, 15, 14, 0, 0) // 2026-08-15 14:00

  it('returns the earliest updatedAt among today sessions', () => {
    const sessions = [
      { updatedAt: new Date(2026, 7, 15, 12, 0, 0).getTime() }, // 12:00
      { updatedAt: new Date(2026, 7, 15, 9, 30, 0).getTime() },  // 09:30 ← earliest
      { updatedAt: new Date(2026, 7, 15, 13, 0, 0).getTime() }, // 13:00
    ]
    expect(getTodayEarliestSession(sessions, today)).toBe(
      new Date(2026, 7, 15, 9, 30, 0).getTime(),
    )
  })

  it('ignores sessions from other days', () => {
    const sessions = [
      { updatedAt: new Date(2026, 7, 14, 23, 30, 0).getTime() }, // yesterday
      { updatedAt: new Date(2026, 7, 15, 9, 30, 0).getTime() },  // today
      { updatedAt: new Date(2026, 7, 16, 0, 30, 0).getTime() }, // tomorrow (boundary check)
    ]
    expect(getTodayEarliestSession(sessions, today)).toBe(
      new Date(2026, 7, 15, 9, 30, 0).getTime(),
    )
  })

  it('returns Infinity when no sessions today', () => {
    const sessions = [
      { updatedAt: new Date(2026, 7, 14, 10, 0, 0).getTime() },
      { updatedAt: new Date(2026, 7, 13, 10, 0, 0).getTime() },
    ]
    expect(getTodayEarliestSession(sessions, today)).toBe(Infinity)
  })

  it('handles empty sessions array', () => {
    expect(getTodayEarliestSession([], today)).toBe(Infinity)
  })

  it('handles boundary at midnight', () => {
    const justBefore = new Date(2026, 7, 15, 23, 59, 59).getTime()
    const justAfter = new Date(2026, 7, 15, 0, 0, 1).getTime()
    const sessions = [
      { updatedAt: justBefore },  // today, last second
      { updatedAt: justAfter },   // today, first second
    ]
    expect(getTodayEarliestSession(sessions, today)).toBe(justAfter)
  })
})

describe('isSameDay', () => {
  it('returns true for same day timestamps', () => {
    const a = new Date(2026, 7, 15, 2, 0, 0).getTime()
    const b = new Date(2026, 7, 15, 22, 0, 0).getTime()
    expect(isSameDay(a, b)).toBe(true)
  })

  it('returns false for different days', () => {
    const a = new Date(2026, 7, 15, 23, 59, 59).getTime()
    const b = new Date(2026, 7, 16, 0, 0, 1).getTime()
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns false for different months', () => {
    const a = new Date(2026, 6, 15, 10, 0, 0).getTime()
    const b = new Date(2026, 7, 15, 10, 0, 0).getTime()
    expect(isSameDay(a, b)).toBe(false)
  })
})

describe('getEarliestMessageTimeFromConversation', () => {
  const today = new Date(2026, 7, 15, 14, 0, 0) // 2026-08-15 14:00

  const makeNode = (time: number, kind = 'user', seq?: number) =>
    ({ data: { time, seq }, kind })

  it('finds earliest message time among today nodes', () => {
    const nodes = [
      makeNode(new Date(2026, 7, 15, 12, 0, 0).getTime(), 'assistant-step'),
      makeNode(new Date(2026, 7, 15, 9, 30, 0).getTime(), 'user'),
      makeNode(new Date(2026, 7, 15, 13, 0, 0).getTime(), 'assistant-step'),
    ]
    expect(getEarliestMessageTimeFromConversation(nodes, new Map(), today)).toBe(
      new Date(2026, 7, 15, 9, 30, 0).getTime(),
    )
  })

  it('ignores nodes from other days', () => {
    const nodes = [
      makeNode(new Date(2026, 7, 14, 23, 30, 0).getTime(), 'user'),
      makeNode(new Date(2026, 7, 15, 9, 30, 0).getTime(), 'user'),
      makeNode(new Date(2026, 7, 16, 0, 30, 0).getTime(), 'assistant-step'),
    ]
    expect(getEarliestMessageTimeFromConversation(nodes, new Map(), today)).toBe(
      new Date(2026, 7, 15, 9, 30, 0).getTime(),
    )
  })

  it('returns Infinity when no messages today', () => {
    const nodes = [
      makeNode(new Date(2026, 7, 14, 10, 0, 0).getTime()),
      makeNode(new Date(2026, 7, 13, 10, 0, 0).getTime()),
    ]
    expect(getEarliestMessageTimeFromConversation(nodes, new Map(), today)).toBe(Infinity)
  })

  it('considers turnTimings startTime', () => {
    const nodes = [
      makeNode(new Date(2026, 7, 15, 12, 0, 0).getTime(), 'assistant-step'),
    ]
    const turnTimings = new Map<number, { startTime: number; endTime?: number }>([
      [1, { startTime: new Date(2026, 7, 15, 9, 0, 0).getTime() }],
      [2, { startTime: new Date(2026, 7, 15, 10, 0, 0).getTime() }],
    ])
    expect(getEarliestMessageTimeFromConversation(nodes, turnTimings, today)).toBe(
      new Date(2026, 7, 15, 9, 0, 0).getTime(),
    )
  })

  it('handles empty nodes and turnTimings', () => {
    expect(getEarliestMessageTimeFromConversation([], new Map(), today)).toBe(Infinity)
  })
})

describe('extractAllMessageTimes', () => {
  it('extracts and sorts all message times', () => {
    const nodes = [
      { data: { time: 3000, seq: 3 }, kind: 'assistant-step' },
      { data: { time: 1000, seq: 1 }, kind: 'user' },
      { data: { time: 2000, seq: 2 }, kind: 'assistant-step' },
    ]
    const result = extractAllMessageTimes(nodes)
    expect(result).toEqual([
      { time: 1000, kind: 'user', seq: 1 },
      { time: 2000, kind: 'assistant-step', seq: 2 },
      { time: 3000, kind: 'assistant-step', seq: 3 },
    ])
  })

  it('filters out nodes without time', () => {
    const nodes = [
      { data: { time: 1000 }, kind: 'user' },
      { data: { seq: 2 }, kind: 'assistant-step' },  // no time
    ]
    const result = extractAllMessageTimes(nodes)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe(1000)
  })

  it('returns empty array for empty input', () => {
    expect(extractAllMessageTimes([])).toEqual([])
  })
})

describe('recordFirstInteraction / getFirstInteraction', () => {
  const storage = new MockStorage()
  const today = new Date(2026, 7, 16, 10, 30, 0) // 2026-08-16 10:30

  it('records first interaction and returns newlyRecorded=true', () => {
    const result = recordFirstInteraction(today, storage)
    expect(result.ts).toBe(today.getTime())
    expect(result.newlyRecorded).toBe(true)
  })

  it('returns existing value if already recorded today', () => {
    const result = recordFirstInteraction(new Date(2026, 7, 16, 11, 0, 0), storage)
    expect(result.ts).toBe(today.getTime()) // 保持第一次的时间
    expect(result.newlyRecorded).toBe(false)
  })

  it('resets on new day', () => {
    const nextDay = new Date(2026, 7, 17, 8, 0, 0) // 2026-08-17
    const result = recordFirstInteraction(nextDay, storage)
    expect(result.ts).toBe(nextDay.getTime())
    expect(result.newlyRecorded).toBe(true)
  })

  it('getFirstInteraction returns null when not recorded', () => {
    const emptyStorage = new MockStorage()
    expect(getFirstInteraction(today, emptyStorage)).toBeNull()
  })

  it('getFirstInteraction returns recorded value', () => {
    const storage2 = new MockStorage()
    recordFirstInteraction(today, storage2)
    expect(getFirstInteraction(today, storage2)).toBe(today.getTime())
  })

  it('getFirstInteraction returns null on different day', () => {
    const storage3 = new MockStorage()
    recordFirstInteraction(today, storage3)
    const otherDay = new Date(2026, 7, 17, 10, 0, 0)
    expect(getFirstInteraction(otherDay, storage3)).toBeNull()
  })
})

describe('idle detection', () => {
  it('recordActivity and getLastActivity', () => {
    const storage = new MockStorage()
    const t = new Date(2026, 7, 16, 10, 0, 0)
    recordActivity(t, storage)
    expect(getLastActivity(storage)).toBe(t.getTime())
  })

  it('getLastActivity returns null when not recorded', () => {
    const storage = new MockStorage()
    expect(getLastActivity(storage)).toBeNull()
  })

  it('getIdleDuration returns 0 when no activity recorded', () => {
    const storage = new MockStorage()
    const now = new Date(2026, 7, 16, 10, 5, 0)
    expect(getIdleDuration(now, storage)).toBe(0)
  })

  it('getIdleDuration returns correct duration', () => {
    const storage = new MockStorage()
    recordActivity(new Date(2026, 7, 16, 10, 0, 0), storage)
    const now = new Date(2026, 7, 16, 10, 5, 0)
    expect(getIdleDuration(now, storage)).toBe(5 * 60 * 1000)
  })

  it('isIdle returns true when idle exceeds threshold', () => {
    const storage = new MockStorage()
    storage.setItem('dsh-office-helper:idle-threshold-minutes', '5')
    recordActivity(new Date(2026, 7, 16, 10, 0, 0), storage)
    const now = new Date(2026, 7, 16, 10, 6, 0)
    expect(isIdle(now, storage)).toBe(true)
  })

  it('isIdle returns false when idle under threshold', () => {
    const storage = new MockStorage()
    storage.setItem('dsh-office-helper:idle-threshold-minutes', '5')
    recordActivity(new Date(2026, 7, 16, 10, 0, 0), storage)
    const now = new Date(2026, 7, 16, 10, 4, 0)
    expect(isIdle(now, storage)).toBe(false)
  })

  it('loadIdleThresholdMinutes returns default', () => {
    const storage = new MockStorage()
    expect(loadIdleThresholdMinutes(storage)).toBe(5)
  })

  it('saveIdleThresholdMinutes and loadIdleThresholdMinutes', () => {
    const storage = new MockStorage()
    saveIdleThresholdMinutes(10, storage)
    expect(loadIdleThresholdMinutes(storage)).toBe(10)
  })
})

describe('daily stats', () => {
  const today = new Date(2026, 7, 16)

  it('loadDailyStats creates new stats for a new day', () => {
    const storage = new MockStorage()
    const stats = loadDailyStats('2026-08-16', storage)
    expect(stats.day).toBe('2026-08-16')
    expect(stats.totalWorkMs).toBe(0)
    expect(stats.totalIdleMs).toBe(0)
    expect(stats.sessionCount).toBe(0)
  })

  it('updateDailyStats patches values', () => {
    const storage = new MockStorage()
    const stats = updateDailyStats('2026-08-16', { workStart: 1000, totalWorkMs: 5000 }, storage)
    expect(stats.workStart).toBe(1000)
    expect(stats.totalWorkMs).toBe(5000)
  })

  it('updateDailyStats does not overwrite existing workStart', () => {
    const storage = new MockStorage()
    updateDailyStats('2026-08-16', { workStart: 1000 }, storage)
    const stats = updateDailyStats('2026-08-16', { workStart: 2000 }, storage)
    expect(stats.workStart).toBe(1000) // 不覆盖
  })

  it('accumulateWorkTime adds to totals', () => {
    const storage = new MockStorage()
    updateDailyStats('2026-08-16', { workStart: 1000 }, storage)
    const stats = accumulateWorkTime('2026-08-16', 3600000, 600000, storage)
    expect(stats.totalWorkMs).toBe(3600000)
    expect(stats.totalIdleMs).toBe(600000)

    const stats2 = accumulateWorkTime('2026-08-16', 1800000, 300000, storage)
    expect(stats2.totalWorkMs).toBe(5400000)
    expect(stats2.totalIdleMs).toBe(900000)
  })

  it('getRecentDays returns stats for last N days', () => {
    const storage = new MockStorage()
    const dayKey = getDayKey(today)
    updateDailyStats(dayKey, { workStart: 1000, totalWorkMs: 3600000 }, storage)
    const recent = getRecentDays(7, storage)
    expect(recent.length).toBeGreaterThanOrEqual(1)
    const todayStats = recent.find(s => s.day === dayKey)
    expect(todayStats).toBeDefined()
    expect(todayStats!.totalWorkMs).toBe(3600000)
  })
})

/* ============ 喝水追踪测试 ============ */

describe('water tracking', () => {
  const today = new Date(2026, 7, 16)

  it('loadWaterIntervalMinutes returns default', () => {
    const storage = new MockStorage()
    expect(loadWaterIntervalMinutes(storage)).toBe(DEFAULT_WATER_INTERVAL_MINUTES)
  })

  it('saveWaterIntervalMinutes and loadWaterIntervalMinutes', () => {
    const storage = new MockStorage()
    saveWaterIntervalMinutes(45, storage)
    expect(loadWaterIntervalMinutes(storage)).toBe(45)
  })

  it('loadWaterGoalCups returns default', () => {
    const storage = new MockStorage()
    expect(loadWaterGoalCups(storage)).toBe(DEFAULT_WATER_GOAL_CUPS)
  })

  it('saveWaterGoalCups and loadWaterGoalCups', () => {
    const storage = new MockStorage()
    saveWaterGoalCups(10, storage)
    expect(loadWaterGoalCups(storage)).toBe(10)
  })

  it('loadWaterState returns fresh state for new day', () => {
    const storage = new MockStorage()
    const state = loadWaterState(today, storage)
    expect(state.day).toBe(getDayKey(today))
    expect(state.cups).toBe(0)
    expect(state.lastCupContWorkMs).toBe(0)
    expect(state.totalWorkMs).toBe(0)
    expect(state.totalIdleMs).toBe(0)
  })

  it('saveWaterState and loadWaterState persist state', () => {
    const storage = new MockStorage()
    const state = { day: '2026-08-16', cups: 3, lastCupContWorkMs: 5400000, totalWorkMs: 5400000, totalIdleMs: 600000 }
    saveWaterState(state, storage)
    const loaded = loadWaterState(new Date(2026, 7, 16), storage)
    expect(loaded.cups).toBe(3)
    expect(loaded.lastCupContWorkMs).toBe(5400000)
    expect(loaded.totalWorkMs).toBe(5400000)
  })

  it('loadWaterState resets when day changes', () => {
    const storage = new MockStorage()
    saveWaterState({ day: '2026-08-15', cups: 5, lastCupContWorkMs: 10000000, totalWorkMs: 10000000, totalIdleMs: 2000000 }, storage)
    const newDay = new Date(2026, 7, 16)
    const state = loadWaterState(newDay, storage)
    expect(state.day).toBe('2026-08-16')
    expect(state.cups).toBe(0)
    expect(state.lastCupContWorkMs).toBe(0)
  })

  it('shouldRemindWater returns false before interval elapsed', () => {
    const state = { day: '2026-08-16', cups: 0, lastCupContWorkMs: 0, totalWorkMs: 0, totalIdleMs: 0 }
    // Only 10 seconds of cont work, 30 min interval
    expect(shouldRemindWater(state, 10000, 30, 8)).toBe(false)
  })

  it('shouldRemindWater returns true when interval elapsed', () => {
    const state = { day: '2026-08-16', cups: 0, lastCupContWorkMs: 0, totalWorkMs: 0, totalIdleMs: 0 }
    // 30 min interval → 1800000ms
    expect(shouldRemindWater(state, 1800000, 30, 8)).toBe(true)
  })

  it('shouldRemindWater uses lastCupContWorkMs as baseline', () => {
    // User already drank, last cup was at 10min cont work
    const state = { day: '2026-08-16', cups: 1, lastCupContWorkMs: 600000, totalWorkMs: 0, totalIdleMs: 0 }
    // Now at 8min cont work → only 2min since last cup < 30min → no remind
    expect(shouldRemindWater(state, 480000 + 600000, 30, 8)).toBe(false)
    // Now at 37min cont work → 37-10=27min < 30min → no remind
    expect(shouldRemindWater(state, 2220000, 30, 8)).toBe(false)
    // Now at 41min cont work → 41-10=31min >= 30min → remind
    expect(shouldRemindWater(state, 2460000, 30, 8)).toBe(true)
  })

  it('shouldRemindWater returns false when goal reached', () => {
    const state = { day: '2026-08-16', cups: 8, lastCupContWorkMs: 0, totalWorkMs: 0, totalIdleMs: 0 }
    expect(shouldRemindWater(state, 100000000, 30, 8)).toBe(false)
  })

  it('shouldRemindWater triggers immediately when interval changed and contWorkMs > lastCupContWorkMs + interval', () => {
    // User sets interval to 5min, already worked 16min since last cup
    const state = { day: '2026-08-16', cups: 0, lastCupContWorkMs: 0, totalWorkMs: 0, totalIdleMs: 0 }
    // 5 min interval = 300000ms
    expect(shouldRemindWater(state, 960000, 5, 8)).toBe(true) // 16min > 5min
  })

  it('markCupDrunk increments cups and resets lastCupContWorkMs', () => {
    const storage = new MockStorage()
    const state = { day: '2026-08-16', cups: 2, lastCupContWorkMs: 5400000, totalWorkMs: 5400000, totalIdleMs: 600000 }
    const newState = markCupDrunk(state, 5400000, storage)
    expect(newState.cups).toBe(3)
    expect(newState.lastCupContWorkMs).toBe(5400000)
  })
})
