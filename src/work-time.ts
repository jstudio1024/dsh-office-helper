/**
 * 工作时间追踪：用 localStorage 记录当天第一次打开 DSH 的时间。
 * 纯函数 + 一个带副作用的 initWorkStart()，便于单测。
 */

const STORAGE_KEY = 'dsh-office-helper:work-start'
const THRESHOLD_KEY = 'dsh-office-helper:rest-threshold-hours'
const FIRST_INTERACTION_KEY = 'dsh-office-helper:first-interaction'
const IDLE_THRESHOLD_KEY = 'dsh-office-helper:idle-threshold-minutes'
const STATS_KEY = 'dsh-office-helper:daily-stats'
const LAST_ACTIVITY_KEY = 'dsh-office-helper:last-activity'
const ACCUMULATED_WORK_KEY = 'dsh-office-helper:accumulated-work'
const ACCUMULATED_IDLE_KEY = 'dsh-office-helper:accumulated-idle'
const CONTWORK_STATE_KEY = 'dsh-office-helper:contwork-state'
const WATER_STATE_KEY = 'dsh-office-helper:water-state'
const WATER_INTERVAL_KEY = 'dsh-office-helper:water-interval-minutes'
const WATER_GOAL_KEY = 'dsh-office-helper:water-goal-cups'

/** 默认休息提醒阈值：4 小时。 */
export const DEFAULT_REST_THRESHOLD_HOURS = 4

/** 返回当天的日期键，如 "2026-08-16"。 */
export function getDayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/**
 * 初始化/获取今天的工作开始时间。
 * - 如果今天还没有记录，记录当前时间作为开始时间；
 * - 如果已有记录，直接返回。
 * @returns Unix epoch 毫秒时间戳
 */
export function initWorkStart(now: Date = new Date(), storage: Storage = localStorage): number {
  const key = getDayKey(now)
  const raw = storage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { day: string; ts: number }
      if (parsed.day === key && typeof parsed.ts === 'number') {
        return parsed.ts
      }
    } catch {
      // 旧格式或损坏，忽略并重新记录
    }
  }
  const ts = now.getTime()
  storage.setItem(STORAGE_KEY, JSON.stringify({ day: key, ts }))
  return ts
}

/**
 * 记录今天第一次鼠标/键盘交互的时间。
 * 如果今天已有记录，返回已有值（不覆盖）。
 * @returns { ts: number; newlyRecorded: boolean }
 */
export function recordFirstInteraction(now: Date = new Date(), storage: Storage = localStorage): { ts: number; newlyRecorded: boolean } {
  const key = getDayKey(now)
  const raw = storage.getItem(FIRST_INTERACTION_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { day: string; ts: number }
      if (parsed.day === key && typeof parsed.ts === 'number') {
        return { ts: parsed.ts, newlyRecorded: false }
      }
    } catch {
      // 旧格式或损坏，忽略并重新记录
    }
  }
  const ts = now.getTime()
  storage.setItem(FIRST_INTERACTION_KEY, JSON.stringify({ day: key, ts }))
  return { ts, newlyRecorded: true }
}

/**
 * 读取今天已记录的首次交互时间（如果有）。
 */
export function getFirstInteraction(now: Date = new Date(), storage: Storage = localStorage): number | null {
  const key = getDayKey(now)
  const raw = storage.getItem(FIRST_INTERACTION_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { day: string; ts: number }
      if (parsed.day === key && typeof parsed.ts === 'number') {
        return parsed.ts
      }
    } catch {
      // 忽略
    }
  }
  return null
}

/**
 * 将毫秒差值格式化为可读字符串，如 "2小时35分钟"、"45分钟"、"刚刚开始"。
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (hours === 0 && minutes === 0) return '刚刚开始'
  if (hours === 0) return `${minutes}分钟`
  if (minutes === 0) return `${hours}小时`
  return `${hours}小时${minutes}分钟`
}

/**
 * 从 localStorage 读取休息提醒阈值（小时），未设置时返回默认值。
 */
export function loadThresholdHours(storage: Storage = localStorage): number {
  const raw = storage.getItem(THRESHOLD_KEY)
  if (raw) {
    const n = parseFloat(raw)
    if (!isNaN(n) && n > 0) return n
  }
  return DEFAULT_REST_THRESHOLD_HOURS
}

/**
 * 将休息提醒阈值（小时）写入 localStorage。
 */
export function saveThresholdHours(hours: number, storage: Storage = localStorage): void {
  storage.setItem(THRESHOLD_KEY, String(hours))
}

/**
 * 判断是否应该显示休息提醒。
 * @param workStart 当天工作开始时间戳（毫秒）
 * @param now 当前时间戳（毫秒）
 * @param thresholdHours 阈值（小时）
 */
export function shouldRest(workStart: number, now: number, thresholdHours: number): boolean {
  const elapsedMs = now - workStart
  const thresholdMs = thresholdHours * 3600 * 1000
  return elapsedMs >= thresholdMs
}

/**
 * 给定一组会话摘要，返回今日最早更新时间的时间戳（毫秒）。
 * 若无今日会话，返回 Infinity（由调用方决定 fallback 策略）。
 * @param sessions 会话摘要数组，每个有 updatedAt 字段（毫秒时间戳）
 * @param now 当前时间
 */
export function getTodayEarliestSession(
  sessions: ReadonlyArray<{ updatedAt: number }>,
  now: Date = new Date(),
): number {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const startOfDayMs = startOfDay.getTime()
  const endOfDayMs = startOfDayMs + 24 * 3600 * 1000

  let earliest = Infinity
  for (const s of sessions) {
    if (s.updatedAt >= startOfDayMs && s.updatedAt < endOfDayMs) {
      if (s.updatedAt < earliest) earliest = s.updatedAt
    }
  }
  return earliest
}

/**
 * 判断一个时间戳是否属于今天。
 */
export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

/** 对话节点的最小接口，只需要 data.time 字段。 */
interface NodeWithTime {
  data: { time?: number }
}

/**
 * 从当前会话的所有对话节点中，找出今日最早的消息时间戳。
 * 遍历所有节点的 data.time 和 turnTimings.startTime，取最小值。
 * @param nodes 会话中的所有对话节点
 * @param turnTimings 回合时间映射
 * @param now 当前时间
 * @returns 今日最早的消息时间戳，若无今日消息返回 Infinity
 */
export function getEarliestMessageTimeFromConversation(
  nodes: ReadonlyArray<NodeWithTime>,
  turnTimings: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>,
  now: Date = new Date(),
): number {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const startOfDayMs = startOfDay.getTime()
  const endOfDayMs = startOfDayMs + 24 * 3600 * 1000

  let earliest = Infinity

  // 从节点中提取消息时间
  for (const node of nodes) {
    const t = node.data?.time
    if (t != null && t >= startOfDayMs && t < endOfDayMs) {
      if (t < earliest) earliest = t
    }
  }

  // 从 turnTimings 中提取回合开始时间
  for (const [, timing] of turnTimings) {
    const t = timing.startTime
    if (t != null && t >= startOfDayMs && t < endOfDayMs) {
      if (t < earliest) earliest = t
    }
  }

  return earliest
}

/**
 * 从对话节点中提取所有消息时间（用于调试日志）。
 * @returns 按时间升序排列的 { time, kind, seq } 数组
 */
export function extractAllMessageTimes(
  nodes: ReadonlyArray<NodeWithTime & { kind?: string }>,
): ReadonlyArray<{ time: number; kind: string; seq?: number }> {
  const result: Array<{ time: number; kind: string; seq?: number }> = []
  for (const node of nodes) {
    const t = node.data?.time
    if (t != null) {
      result.push({ time: t, kind: node.kind ?? 'unknown', seq: (node.data as any)?.seq })
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

/* ============ 空闲检测 ============ */

/** 默认空闲阈值：5 分钟。 */
export const DEFAULT_IDLE_THRESHOLD_MINUTES = 5

export function loadIdleThresholdMinutes(storage: Storage = localStorage): number {
  const raw = storage.getItem(IDLE_THRESHOLD_KEY)
  if (raw) {
    const n = parseFloat(raw)
    if (!isNaN(n) && n > 0) return n
  }
  return DEFAULT_IDLE_THRESHOLD_MINUTES
}

export function saveIdleThresholdMinutes(minutes: number, storage: Storage = localStorage): void {
  storage.setItem(IDLE_THRESHOLD_KEY, String(minutes))
}

/**
 * 记录最后一次交互时间。
 */
export function recordActivity(now: Date = new Date(), storage: Storage = localStorage): void {
  storage.setItem(LAST_ACTIVITY_KEY, String(now.getTime()))
}

/**
 * 获取最后一次交互时间戳。
 */
export function getLastActivity(storage: Storage = localStorage): number | null {
  const raw = storage.getItem(LAST_ACTIVITY_KEY)
  if (raw) {
    const ts = parseInt(raw, 10)
    if (!isNaN(ts)) return ts
  }
  return null
}

/**
 * 计算当前空闲时长（毫秒）。
 */
export function getIdleDuration(now: Date = new Date(), storage: Storage = localStorage): number {
  const last = getLastActivity(storage)
  if (last === null) return 0
  return Math.max(0, now.getTime() - last)
}

/**
 * 判断当前是否处于空闲状态。
 */
export function isIdle(now: Date = new Date(), storage: Storage = localStorage): boolean {
  const idleMs = getIdleDuration(now, storage)
  const thresholdMs = loadIdleThresholdMinutes(storage) * 60 * 1000
  return idleMs >= thresholdMs
}

/* ============ 每日统计 ============ */

export interface DailyStats {
  day: string
  workStart: number | null
  firstInteraction: number | null
  totalWorkMs: number
  totalIdleMs: number
  contWorkMs: number
  contWorkStart: number | null
  idleSessions: Array<{ start: number; end: number }>
  sessionCount: number
  messageCount: number
  updatedAt: number
}

export function loadDailyStats(dayKey: string, storage: Storage = localStorage): DailyStats {
  const raw = storage.getItem(STATS_KEY)
  let all: Record<string, DailyStats> = {}
  if (raw) {
    try {
      all = JSON.parse(raw) as Record<string, DailyStats>
    } catch {
      all = {}
    }
  }
  if (!all[dayKey]) {
    all[dayKey] = {
      day: dayKey,
      workStart: null,
      firstInteraction: null,
      totalWorkMs: 0,
      totalIdleMs: 0,
      contWorkMs: 0,
      contWorkStart: null,
      idleSessions: [],
      sessionCount: 0,
      messageCount: 0,
      updatedAt: Date.now(),
    }
  }
  return all[dayKey]
}

export function saveDailyStats(stats: DailyStats, storage: Storage = localStorage): void {
  const raw = storage.getItem(STATS_KEY)
  let all: Record<string, DailyStats> = {}
  if (raw) {
    try {
      all = JSON.parse(raw) as Record<string, DailyStats>
    } catch {
      all = {}
    }
  }
  all[stats.day] = stats
  storage.setItem(STATS_KEY, JSON.stringify(all))
}

export function updateDailyStats(
  dayKey: string,
  patch: Partial<Pick<DailyStats, 'workStart' | 'firstInteraction' | 'totalWorkMs' | 'totalIdleMs' | 'sessionCount' | 'messageCount'>>,
  storage: Storage = localStorage,
): DailyStats {
  const stats = loadDailyStats(dayKey, storage)
  if (patch.workStart !== undefined && stats.workStart === null) stats.workStart = patch.workStart
  if (patch.firstInteraction !== undefined && stats.firstInteraction === null) stats.firstInteraction = patch.firstInteraction
  if (patch.totalWorkMs !== undefined) stats.totalWorkMs = patch.totalWorkMs
  if (patch.totalIdleMs !== undefined) stats.totalIdleMs = patch.totalIdleMs
  if (patch.sessionCount !== undefined) stats.sessionCount = patch.sessionCount
  if (patch.messageCount !== undefined) stats.messageCount = patch.messageCount
  stats.updatedAt = Date.now()
  saveDailyStats(stats, storage)
  return stats
}

/**
 * 累积本次会话的工作/空闲时间到今日统计。
 */
export function accumulateWorkTime(
  dayKey: string,
  workMs: number,
  idleMs: number,
  storage: Storage = localStorage,
): DailyStats {
  const stats = loadDailyStats(dayKey, storage)
  stats.totalWorkMs += workMs
  stats.totalIdleMs += idleMs
  stats.updatedAt = Date.now()
  saveDailyStats(stats, storage)
  return stats
}

/**
 * 获取最近 N 天的统计数据。
 */
export function getRecentDays(days: number = 7, storage: Storage = localStorage): DailyStats[] {
  const raw = storage.getItem(STATS_KEY)
  let all: Record<string, DailyStats> = {}
  if (raw) {
    try {
      all = JSON.parse(raw) as Record<string, DailyStats>
    } catch {
      return []
    }
  }
  const result: DailyStats[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = getDayKey(d)
    if (all[key]) result.push(all[key])
  }
  return result
}

/* ============ 持久化累积工作/空闲时间 ============ */

export interface AccumulatedTime {
  day: string
  workMs: number
  idleMs: number
}

function loadAccumulated(key: string, now: Date, storage: Storage): AccumulatedTime {
  const dayKey = getDayKey(now)
  const raw = storage.getItem(key)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AccumulatedTime
      if (parsed.day === dayKey) return parsed
    } catch {
      // ignore, day mismatch or corrupt → reset
    }
  }
  return { day: dayKey, workMs: 0, idleMs: 0 }
}

function saveAccumulated(key: string, value: AccumulatedTime, storage: Storage): void {
  storage.setItem(key, JSON.stringify(value))
}

export function loadAccumulatedWork(now: Date = new Date(), storage: Storage = localStorage): AccumulatedTime {
  return loadAccumulated(ACCUMULATED_WORK_KEY, now, storage)
}

export function saveAccumulatedWork(value: AccumulatedTime, storage: Storage = localStorage): void {
  saveAccumulated(ACCUMULATED_WORK_KEY, value, storage)
}

export function loadAccumulatedIdle(now: Date = new Date(), storage: Storage = localStorage): AccumulatedTime {
  return loadAccumulated(ACCUMULATED_IDLE_KEY, now, storage)
}

export function saveAccumulatedIdle(value: AccumulatedTime, storage: Storage = localStorage): void {
  saveAccumulated(ACCUMULATED_IDLE_KEY, value, storage)
}

/* ============ 持续工作追踪 ============ */

export interface ContWorkState {
  day: string
  sessionStart: number | null
  accumulatedIdleMs: number
}

export function loadContWorkState(now: Date = new Date(), storage: Storage = localStorage): ContWorkState {
  const dayKey = getDayKey(now)
  const raw = storage.getItem(CONTWORK_STATE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ContWorkState
      if (parsed.day === dayKey) return parsed
    } catch {
      // ignore
    }
  }
  return { day: dayKey, sessionStart: null, accumulatedIdleMs: 0 }
}

export function saveContWorkState(state: ContWorkState, storage: Storage = localStorage): void {
  storage.setItem(CONTWORK_STATE_KEY, JSON.stringify(state))
}

/**
 * 计算持续工作时长（不含空闲）。
 * @param sessionStart 本轮持续工作的开始时间戳
 * @param accumulatedIdleMs 本轮已累积的空闲毫秒
 * @param now 当前时间戳
 */
export function calcContWorkMs(sessionStart: number | null, accumulatedIdleMs: number, now: number): number {
  if (sessionStart === null) return 0
  return Math.max(0, now - sessionStart - accumulatedIdleMs)
}

/* ============ 喝水追踪 ============ */

export const DEFAULT_WATER_INTERVAL_MINUTES = 30
export const DEFAULT_WATER_GOAL_CUPS = 8

export interface WaterState {
  day: string
  cups: number
  lastCupContWorkMs: number
  totalWorkMs: number
  totalIdleMs: number
}

export function loadWaterIntervalMinutes(storage: Storage = localStorage): number {
  const raw = storage.getItem(WATER_INTERVAL_KEY)
  if (raw) {
    const n = parseFloat(raw)
    if (!isNaN(n) && n > 0) return n
  }
  return DEFAULT_WATER_INTERVAL_MINUTES
}

export function saveWaterIntervalMinutes(minutes: number, storage: Storage = localStorage): void {
  storage.setItem(WATER_INTERVAL_KEY, String(minutes))
}

export function loadWaterGoalCups(storage: Storage = localStorage): number {
  const raw = storage.getItem(WATER_GOAL_KEY)
  if (raw) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n > 0) return n
  }
  return DEFAULT_WATER_GOAL_CUPS
}

export function saveWaterGoalCups(cups: number, storage: Storage = localStorage): void {
  storage.setItem(WATER_GOAL_KEY, String(cups))
}

export function loadWaterState(now: Date = new Date(), storage: Storage = localStorage): WaterState {
  const dayKey = getDayKey(now)
  const raw = storage.getItem(WATER_STATE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed.day === dayKey) {
        // Migrate old format (had lastReminderTime instead of lastCupContWorkMs)
        const lastCupContWorkMs = typeof parsed.lastCupContWorkMs === 'number'
          ? parsed.lastCupContWorkMs
          : 0
        return {
          day: dayKey,
          cups: typeof parsed.cups === 'number' ? parsed.cups : 0,
          lastCupContWorkMs,
          totalWorkMs: typeof parsed.totalWorkMs === 'number' ? parsed.totalWorkMs : 0,
          totalIdleMs: typeof parsed.totalIdleMs === 'number' ? parsed.totalIdleMs : 0,
        }
      }
    } catch {
      // ignore
    }
  }
  return {
    day: dayKey,
    cups: 0,
    lastCupContWorkMs: 0,
    totalWorkMs: 0,
    totalIdleMs: 0,
  }
}

export function saveWaterState(state: WaterState, storage: Storage = localStorage): void {
  storage.setItem(WATER_STATE_KEY, JSON.stringify(state))
}

/**
 * 判断当前是否应该触发喝水提醒。
 * 每次喝一杯后，lastCupContWorkMs 重置为当前 contWorkMs。
 * @param state 当前喝水状态
 * @param currentContWorkMs 当前持续工作毫秒
 * @param intervalMinutes 间隔分钟数
 * @param goalCups 目标杯数
 * @returns true 表示应该提醒
 */
export function shouldRemindWater(state: WaterState, currentContWorkMs: number, intervalMinutes: number, goalCups: number): boolean {
  if (state.cups >= goalCups) return false
  const elapsed = currentContWorkMs - state.lastCupContWorkMs
  return elapsed >= intervalMinutes * 60 * 1000
}

/**
 * 标记已喝一杯，重置计时器为当前持续工作时间。
 */
export function markCupDrunk(state: WaterState, currentContWorkMs: number, storage: Storage = localStorage): WaterState {
  const newState: WaterState = {
    ...state,
    cups: state.cups + 1,
    lastCupContWorkMs: currentContWorkMs,
  }
  saveWaterState(newState, storage)
  return newState
}
