import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { formatLocal } from '../utc-string.ts'
import {
  formatDuration, initWorkStart, loadThresholdHours, saveThresholdHours,
  getTodayEarliestSession, getDayKey, getEarliestMessageTimeFromConversation, extractAllMessageTimes,
  recordFirstInteraction, getFirstInteraction,
  recordActivity, getLastActivity, getIdleDuration, isIdle, loadIdleThresholdMinutes, saveIdleThresholdMinutes,
  loadDailyStats, saveDailyStats, getRecentDays, type DailyStats,
  loadAccumulatedWork, saveAccumulatedWork, loadAccumulatedIdle, saveAccumulatedIdle,
  loadContWorkState, saveContWorkState, calcContWorkMs,
  type AccumulatedTime, type ContWorkState,
  loadWaterState, saveWaterState, loadWaterIntervalMinutes, saveWaterIntervalMinutes,
  loadWaterGoalCups, saveWaterGoalCups, shouldRemindWater, markCupDrunk,
  type WaterState,
} from '../work-time.ts'

type SnapshotSelectorHook<T> = <S>(selector: (state: T) => S) => S

interface SessionSummary {
  updatedAt: number
}

interface SessionListState {
  byId: Record<string, SessionSummary>
}

interface ConversationNode {
  kind: string
  data: { time?: number; seq?: number }
}

interface ConversationSnapshot {
  chat?: {
    nodes?: { values: () => readonly ConversationNode[] }
    legacy?: {
      turnTimings: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>
    }
  }
}

interface UtcClockProps {
  useSessions?: SnapshotSelectorHook<SessionListState>
  useSession?: SnapshotSelectorHook<ConversationSnapshot | undefined>
}

export function UtcClock({ useSessions, useSession }: UtcClockProps): React.ReactElement {
  const [now, setNow] = useState(() => new Date())
  const [threshold, setThreshold] = useState(() => loadThresholdHours())
  const [idleThreshold, setIdleThreshold] = useState(() => loadIdleThresholdMinutes())
  const [showReport, setShowReport] = useState(false)
  const [localWorkStart, setLocalWorkStart] = useState(() => initWorkStart())
  const [dayKey, setDayKey] = useState(() => getDayKey())
  const [firstInteractionTime, setFirstInteractionTime] = useState<number | null>(
    () => getFirstInteraction()
  )
  const [resetCounter, setResetCounter] = useState(0)

  const [waterInterval, setWaterInterval] = useState(() => loadWaterIntervalMinutes())
  const [waterGoalCups, setWaterGoalCups] = useState(() => loadWaterGoalCups())
  const [showWaterBanner, setShowWaterBanner] = useState(false)
  const [waterBannerKey, setWaterBannerKey] = useState(0)

  const interactionRecordedRef = useRef(false)
  const idleStartRef = useRef<number | null>(null)
  const prevTickRef = useRef<number>(Date.now())
  const workAccumRef = useRef<AccumulatedTime>(loadAccumulatedWork())
  const idleAccumRef = useRef<AccumulatedTime>(loadAccumulatedIdle())
  const contWorkRef = useRef<ContWorkState>(loadContWorkState())
  const waterStateInit = loadWaterState()
  const workAccumInit = loadAccumulatedWork()
  if (waterStateInit.day === workAccumInit.day) {
    waterStateInit.totalWorkMs = workAccumInit.workMs
    waterStateInit.totalIdleMs = workAccumInit.idleMs
  }
  const waterStateRef = useRef<WaterState>(waterStateInit)

  const handleInteraction = useCallback(() => {
    const now = new Date()
    recordActivity(now)

    if (!interactionRecordedRef.current) {
      interactionRecordedRef.current = true
      const result = recordFirstInteraction(now)
      setFirstInteractionTime(result.ts)
    }

    if (idleStartRef.current !== null) {
      const idleMs = now.getTime() - idleStartRef.current
      idleAccumRef.current.workMs = idleAccumRef.current.workMs // no change
      contWorkRef.current.accumulatedIdleMs += idleMs
      idleStartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (firstInteractionTime !== null) return

    window.addEventListener('mousemove', handleInteraction, { once: true, passive: true })
    window.addEventListener('mousedown', handleInteraction, { once: true, passive: true })
    window.addEventListener('keydown', handleInteraction, { once: true, passive: true })
    window.addEventListener('wheel', handleInteraction, { once: true, passive: true })
    window.addEventListener('touchstart', handleInteraction, { once: true, passive: true })

    return () => {
      window.removeEventListener('mousemove', handleInteraction)
      window.removeEventListener('mousedown', handleInteraction)
      window.removeEventListener('keydown', handleInteraction)
      window.removeEventListener('wheel', handleInteraction)
      window.removeEventListener('touchstart', handleInteraction)
    }
  }, [firstInteractionTime, handleInteraction])

  useEffect(() => {
    const onActivity = () => handleInteraction()
    window.addEventListener('mousemove', onActivity, { passive: true })
    window.addEventListener('mousedown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity, { passive: true })
    window.addEventListener('wheel', onActivity, { passive: true })
    window.addEventListener('touchstart', onActivity, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('mousedown', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('wheel', onActivity)
      window.removeEventListener('touchstart', onActivity)
    }
  }, [handleInteraction])

  useEffect(() => {
    recordActivity(new Date())
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const newNow = new Date()
      const newDayKey = getDayKey(newNow)

      if (newDayKey !== dayKey) {
        setDayKey(newDayKey)
        setLocalWorkStart(newNow.getTime())
        setFirstInteractionTime(null)
        interactionRecordedRef.current = false
        idleStartRef.current = null
        prevTickRef.current = newNow.getTime()

        // Reset persistent state for new day
        workAccumRef.current = { day: newDayKey, workMs: 0, idleMs: 0 }
        idleAccumRef.current = { day: newDayKey, workMs: 0, idleMs: 0 }
        contWorkRef.current = { day: newDayKey, sessionStart: null, accumulatedIdleMs: 0 }
        waterStateRef.current = { day: newDayKey, cups: 0, lastReminderTime: null, totalWorkMs: 0, totalIdleMs: 0 }
        setShowWaterBanner(false)
      }

      // Tick-based accumulation
      const delta = newNow.getTime() - prevTickRef.current
      prevTickRef.current = newNow.getTime()

      const currentIdleMs = getIdleDuration(newNow)
      const isIdleNow = currentIdleMs >= idleThreshold * 60 * 1000

      if (isIdleNow) {
        idleAccumRef.current.idleMs += delta
        contWorkRef.current.accumulatedIdleMs += delta
        waterStateRef.current.totalIdleMs += delta
      } else {
        workAccumRef.current.workMs += delta
        waterStateRef.current.totalWorkMs = workAccumRef.current.workMs
      }

      // Check water reminder (only when not idle)
      if (!isIdleNow) {
        const currentContWorkMs = calcContWorkMs(
          contWorkRef.current.sessionStart,
          contWorkRef.current.accumulatedIdleMs,
          newNow.getTime()
        )
        if (shouldRemindWater(waterStateRef.current, currentContWorkMs, waterInterval, waterGoalCups)) {
          waterStateRef.current.lastReminderTime = newNow.getTime()
          saveWaterState(waterStateRef.current)
          setShowWaterBanner(true)
          setWaterBannerKey(k => k + 1)
        }
      }

      // Persist
      saveAccumulatedWork(workAccumRef.current)
      saveAccumulatedIdle(idleAccumRef.current)
      saveContWorkState(contWorkRef.current)
      saveWaterState(waterStateRef.current)

      setNow(newNow)
    }, 1000)
    return () => clearInterval(timer)
  }, [dayKey, idleThreshold, waterInterval, waterGoalCups])

  const sessionsById = useSessions ? useSessions(state => state.byId) : {}
  const sessions = useMemo(() => Object.values(sessionsById), [sessionsById])

  const earliestSessionToday = useMemo(
    () => getTodayEarliestSession(sessions, now),
    [sessions, now]
  )

  const conversation = useSession
    ? useSession(state => state)
    : undefined

  const currentNodes = useMemo(
    () => conversation?.chat?.nodes?.values() ?? [],
    [conversation]
  )

  const currentTurnTimings = useMemo(
    () => conversation?.chat?.legacy?.turnTimings ?? new Map(),
    [conversation]
  )

  const earliestMessageToday = useMemo(
    () => getEarliestMessageTimeFromConversation(currentNodes, currentTurnTimings, now),
    [currentNodes, currentTurnTimings, now]
  )

  const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const localWorkStartIsToday = localWorkStart >= todayStartMs

  let effectiveWorkStart: number
  let dataSource: string
  if (firstInteractionTime !== null) {
    effectiveWorkStart = firstInteractionTime
    dataSource = 'first_mouse_keyboard_interaction'
  } else if (earliestMessageToday !== Infinity) {
    effectiveWorkStart = earliestMessageToday
    dataSource = 'current_conversation_messages'
  } else if (earliestSessionToday !== Infinity) {
    effectiveWorkStart = earliestSessionToday
    dataSource = 'all_sessions_updatedAt'
  } else if (localWorkStartIsToday) {
    effectiveWorkStart = localWorkStart
    dataSource = 'local_work_start_fallback'
  } else {
    effectiveWorkStart = localWorkStart
    dataSource = 'local_work_start_fallback_prev_day'
  }

  const idleMsNow = getIdleDuration(now)
  const isIdleNow = idleMsNow >= idleThreshold * 60 * 1000

  // Update continuous work session start on first interaction
  useEffect(() => {
    if (firstInteractionTime !== null && contWorkRef.current.sessionStart === null) {
      contWorkRef.current.sessionStart = firstInteractionTime
      saveContWorkState(contWorkRef.current)
    }
  }, [firstInteractionTime])

  // Continuous work time (excludes idle, persists across restarts)
  const contWorkMs = calcContWorkMs(
    contWorkRef.current.sessionStart,
    contWorkRef.current.accumulatedIdleMs,
    now.getTime()
  )

  const totalIdleMs = idleAccumRef.current.idleMs + (idleStartRef.current !== null ? (now.getTime() - idleStartRef.current) : 0)
  const totalWorkMs = workAccumRef.current.workMs

  const needsRest = contWorkMs >= threshold * 3600 * 1000

  const handleResetContWork = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    contWorkRef.current.sessionStart = new Date().getTime()
    contWorkRef.current.accumulatedIdleMs = 0
    saveContWorkState(contWorkRef.current)
    setResetCounter(c => c + 1)
  }, [])

  const handleDrinkWater = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const currentContWorkMs = calcContWorkMs(
      contWorkRef.current.sessionStart,
      contWorkRef.current.accumulatedIdleMs,
      Date.now()
    )
    waterStateRef.current = markCupDrunk(waterStateRef.current, currentContWorkMs)
    setShowWaterBanner(false)
    setResetCounter(c => c + 1)
  }, [])

  const handleDismissWaterBanner = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowWaterBanner(false)
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowReport(v => !v)
  }

  const sessionsToday = useMemo(
    () => sessions.filter(s => s.updatedAt >= todayStartMs && s.updatedAt < todayStartMs + 86400000),
    [sessions, todayStartMs]
  )

  const msgCountToday = useMemo(
    () => currentNodes.filter(n => {
      const t = n.data?.time
      return t != null && t >= todayStartMs && t < todayStartMs + 86400000
    }).length,
    [currentNodes, todayStartMs]
  )

  const todayStats: DailyStats = useMemo(() => ({
    day: dayKey,
    workStart: effectiveWorkStart,
    firstInteraction: firstInteractionTime,
    totalWorkMs: workAccumRef.current.workMs,
    totalIdleMs: idleAccumRef.current.idleMs + (idleStartRef.current !== null ? (now.getTime() - idleStartRef.current) : 0),
    contWorkMs: calcContWorkMs(contWorkRef.current.sessionStart, contWorkRef.current.accumulatedIdleMs, now.getTime()),
    contWorkStart: contWorkRef.current.sessionStart,
    idleSessions: [],
    sessionCount: sessionsToday.length,
    messageCount: msgCountToday,
    updatedAt: now.getTime(),
  }), [dayKey, effectiveWorkStart, firstInteractionTime, totalIdleMs, sessionsToday, msgCountToday, now, resetCounter])

  // Save stats periodically
  useEffect(() => {
    saveDailyStats(todayStats)
  }, [todayStats])

  // ====== 调试日志 ======
  useEffect(() => {
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayStartMs = todayStart.getTime()
    const todayEndMs = todayStartMs + 24 * 3600 * 1000

    const todaySessions = sessions.filter(
      s => s.updatedAt >= todayStartMs && s.updatedAt < todayEndMs
    )

    const allMsgTimes = extractAllMessageTimes(currentNodes)
    const todayMsgTimes = allMsgTimes.filter(m => m.time >= todayStartMs && m.time < todayEndMs)

    console.log('[dsh-office-helper] 调试数据:', {
      timestamp: now.toISOString(),
      localTime: formatLocal(now),
      状态: {
        isIdle: isIdleNow,
        idleDurationMin: Math.floor(idleMsNow / 60000),
        dataSource,
      },
      会话列表: {
        total: sessions.length,
        todayCount: todaySessions.length,
      },
      最终决策: {
        effectiveWorkStart: formatLocal(new Date(effectiveWorkStart)),
        totalWorkMs,
        totalIdleMs,
        contWorkMs,
        contWorkStart: contWorkRef.current.sessionStart ? formatLocal(new Date(contWorkRef.current.sessionStart)) : '—',
      },
      喝水追踪: {
        cups: waterStateRef.current.cups,
        goalCups: waterGoalCups,
        intervalMin: waterInterval,
        lastCupContWorkMs: waterStateRef.current.lastCupContWorkMs,
        elapsedSinceLastCup: contWorkMs - waterStateRef.current.lastCupContWorkMs,
        shouldRemind: shouldRemindWater(waterStateRef.current, contWorkMs, waterInterval, waterGoalCups),
      },
      每日统计: todayStats,
    })
  }, [sessions, currentNodes, effectiveWorkStart, dataSource, isIdleNow, idleMsNow, totalWorkMs, totalIdleMs, contWorkMs, todayStats, now, waterInterval, waterGoalCups, resetCounter])

  // ====== 渲染 ======
  const textColor = isIdleNow ? '#bbb' : 'var(--dsh-fg-3, #888)'

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: textColor,
        marginRight: '8px',
        whiteSpace: 'nowrap',
        gap: '8px',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      title={isIdleNow ? '已空闲，计时暂停' : needsRest ? '该休息了！点击查看详情' : '点击查看每日工作报告'}
      onClick={handleClick}
    >
      <span>{formatLocal(now)}</span>
      <span style={{ color: 'var(--dsh-fg-2, #666)' }}>·</span>
      {isIdleNow ? (
        <span style={{ color: '#f39c12' }}>
          已空闲 {formatDuration(idleMsNow)}
        </span>
      ) : (
        <span>今日工作 {formatDuration(totalWorkMs)}</span>
      )}
      {!isIdleNow && contWorkMs > 0 && (
        <span style={{ color: 'var(--dsh-fg-2, #666)' }}>·</span>
      )}
      {!isIdleNow && contWorkMs > 0 && (
        <span style={{ color: '#3498db' }}>
          持续 {formatDuration(contWorkMs)}
        </span>
      )}
      {needsRest && !isIdleNow && !showReport && (
        <span
          style={{
            color: '#ff6b6b',
            fontWeight: 'bold',
            animation: 'pulse 1.5s infinite',
          }}
        >
          该休息了！
        </span>
      )}
      {waterStateRef.current.cups < waterGoalCups && !isIdleNow && (
        <span
          style={{
            color: '#3498db',
            animation: showWaterBanner ? 'pulse 0.8s infinite' : 'none',
          }}
        >
          💧 {waterStateRef.current.cups}/{waterGoalCups}
        </span>
      )}
      {waterStateRef.current.cups >= waterGoalCups && (
        <span style={{ color: '#27ae60' }}>💧 今日完成</span>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>

      {showReport && (
        <ReportPanel
          stats={todayStats}
          recentDays={getRecentDays(7)}
          onClose={() => setShowReport(false)}
          threshold={threshold}
          idleThreshold={idleThreshold}
          onThresholdChange={(v) => { setThreshold(v); saveThresholdHours(v) }}
          onIdleThresholdChange={(v) => { setIdleThreshold(v); saveIdleThresholdMinutes(v) }}
          onResetContWork={handleResetContWork}
          waterState={waterStateRef.current}
          waterInterval={waterInterval}
          waterGoalCups={waterGoalCups}
          onWaterIntervalChange={(v) => { setWaterInterval(v); saveWaterIntervalMinutes(v) }}
          onWaterGoalChange={(v) => { setWaterGoalCups(v); saveWaterGoalCups(v) }}
          onDrinkWater={handleDrinkWater}
        />
      )}

      {showWaterBanner && (
        <div
          key={waterBannerKey}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '20px',
            left: '0',
            zIndex: 9999,
            background: '#3498db',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(52,152,219,0.4)',
            fontFamily: 'inherit',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            whiteSpace: 'nowrap',
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          <span style={{ fontSize: '16px' }}>💧</span>
          <span>该喝水了！已持续工作 {formatDuration(contWorkMs)}</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleDrinkWater(e) }}
            style={{
              padding: '4px 10px',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '11px',
            }}
          >
            已喝
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDismissWaterBanner(e) }}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '14px',
            }}
          >
            ✕
          </button>
        </div>
      )}
      <style>{`@keyframes slideIn { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </span>
  )
}

/* ============ 报告面板 ============ */

interface ReportPanelProps {
  stats: DailyStats
  recentDays: DailyStats[]
  onClose: () => void
  threshold: number
  idleThreshold: number
  onThresholdChange: (v: number) => void
  onIdleThresholdChange: (v: number) => void
  onResetContWork: (e: React.MouseEvent) => void
  waterState: WaterState
  waterInterval: number
  waterGoalCups: number
  onWaterIntervalChange: (v: number) => void
  onWaterGoalChange: (v: number) => void
  onDrinkWater: (e: React.MouseEvent) => void
}

function ReportPanel({ stats, recentDays, onClose, threshold, idleThreshold, onThresholdChange, onIdleThresholdChange, onResetContWork, waterState, waterInterval, waterGoalCups, onWaterIntervalChange, onWaterGoalChange, onDrinkWater }: ReportPanelProps): React.ReactElement {
  const [tab, setTab] = useState<'today' | 'water' | 'settings'>('today')
  const [tempThreshold, setTempThreshold] = useState(String(threshold))
  const [tempIdleThreshold, setTempIdleThreshold] = useState(String(idleThreshold))
  const [tempWaterInterval, setTempWaterInterval] = useState(String(waterInterval))
  const [tempWaterGoal, setTempWaterGoal] = useState(String(waterGoalCups))

  const totalElapsed = stats.totalWorkMs + stats.totalIdleMs
  const workPct = totalElapsed > 0 ? Math.round((stats.totalWorkMs / totalElapsed) * 100) : 0
  const idlePct = totalElapsed > 0 ? 100 - workPct : 0

  const barMax = Math.max(
    stats.totalWorkMs,
    stats.totalIdleMs,
    ...recentDays.map(d => d.totalWorkMs + d.totalIdleMs),
    3600000,
  )

  return (
    <div
      style={{
        position: 'absolute',
        top: '20px',
        right: '0',
        zIndex: 9999,
        background: 'var(--dsh-bg-1, #fff)',
        border: '1px solid var(--dsh-fg-3, #ccc)',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        padding: '16px',
        minWidth: '300px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: 'var(--dsh-fg-1, #333)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <strong style={{ fontSize: '14px' }}>📊 每日工作报告</strong>
        <span
          style={{ cursor: 'pointer', color: 'var(--dsh-fg-3, #999)', fontSize: '16px', lineHeight: 1 }}
          onClick={onClose}
        >
          ✕
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', borderBottom: '1px solid var(--dsh-fg-3, #eee)', paddingBottom: '8px' }}>
        <button onClick={() => setTab('today')} style={tab === 'today' ? tabBtnActive : tabBtn}>今日</button>
        <button onClick={() => setTab('water')} style={tab === 'water' ? tabBtnActive : tabBtn}>💧 喝水</button>
        <button onClick={() => setTab('settings')} style={tab === 'settings' ? tabBtnActive : tabBtn}>设置</button>
      </div>

      {tab === 'today' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <StatCard label="开始时间" value={stats.workStart ? formatLocal(new Date(stats.workStart)) : '—'} />
            <StatCard label="首条交互" value={stats.firstInteraction ? formatLocal(new Date(stats.firstInteraction)) : '—'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <StatCard label="今日总工作" value={formatDuration(stats.totalWorkMs)} accent="#27ae60" />
            <StatCard label="持续工作" value={formatDuration(stats.contWorkMs)} accent="#3498db" />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>工作 <strong style={{ color: '#27ae60' }}>{formatDuration(stats.totalWorkMs)}</strong></span>
              <span>空闲 <strong style={{ color: '#f39c12' }}>{formatDuration(stats.totalIdleMs)}</strong></span>
            </div>
            <div style={{ height: '12px', borderRadius: '6px', overflow: 'hidden', display: 'flex', background: 'var(--dsh-fg-3, #eee)' }}>
              <div style={{ width: `${workPct}%`, background: '#27ae60', transition: 'width 0.3s' }} />
              <div style={{ width: `${idlePct}%`, background: '#f39c12', transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px', fontSize: '11px', color: 'var(--dsh-fg-3, #999)' }}>
              <span>{workPct}% 工作</span>
              <span>{idlePct}% 空闲</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <StatCard label="今日会话" value={String(stats.sessionCount)} />
            <StatCard label="今日消息" value={String(stats.messageCount)} />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              onClick={(e) => onResetContWork(e)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #3498db',
                background: '#3498db',
                color: '#fff',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '12px',
              }}
            >
              😌 放松下（重置持续工作）
            </button>
          </div>

          {recentDays.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>最近 7 天</div>
              {recentDays.map(d => {
                const total = d.totalWorkMs + d.totalIdleMs
                const workRatio = total > 0 ? d.totalWorkMs / barMax : 0
                return (
                  <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ width: '70px', color: 'var(--dsh-fg-3, #999)' }}>{d.day.slice(5)}</span>
                    <div style={{ flex: 1, height: '10px', borderRadius: '3px', background: 'var(--dsh-fg-3, #eee)', overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${workRatio * 100}%`, height: '100%', background: '#27ae60' }} />
                    </div>
                    <span style={{ width: '60px', textAlign: 'right' }}>{formatDuration(total)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'water' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <StatCard label="今日已喝" value={`${waterState.cups}/${waterGoalCups} 杯`} accent="#3498db" />
            <StatCard
              label="距上次喝水"
              value={waterState.cups >= waterGoalCups ? '已完成' : `${Math.floor((stats.contWorkMs - waterState.lastCupContWorkMs) / 60000)} 分钟`}
            />
          </div>

          {waterState.cups < waterGoalCups && (
            <div style={{ marginBottom: '12px', padding: '8px 12px', background: 'var(--dsh-fg-3, #f5f5f5)', borderRadius: '6px', fontSize: '12px' }}>
              下次提醒还有 <strong>{Math.max(0, waterInterval * 60 - Math.floor((stats.contWorkMs - waterState.lastCupContWorkMs) / 1000))} 秒</strong>
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>进度</span>
              <span>{waterState.cups}/{waterGoalCups} 杯</span>
            </div>
            <div style={{ height: '12px', borderRadius: '6px', overflow: 'hidden', display: 'flex', background: 'var(--dsh-fg-3, #eee)' }}>
              <div
                style={{
                  width: `${(waterState.cups / waterGoalCups) * 100}%`,
                  background: '#3498db',
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              onClick={(e) => onDrinkWater(e)}
              disabled={waterState.cups >= waterGoalCups}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: waterState.cups >= waterGoalCups ? '1px solid #ccc' : '1px solid #3498db',
                background: waterState.cups >= waterGoalCups ? '#ccc' : '#3498db',
                color: '#fff',
                cursor: waterState.cups >= waterGoalCups ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                fontSize: '12px',
              }}
            >
              💧 已喝一杯
            </button>
          </div>

          {waterState.cups >= waterGoalCups && (
            <div style={{ textAlign: 'center', color: '#27ae60', fontWeight: 'bold' }}>
              🎉 今日目标已完成！
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>休息提醒阈值（小时）</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="number" min="0.5" max="24" step="0.5"
                value={tempThreshold}
                onChange={(e) => setTempThreshold(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat(tempThreshold)
                    if (!isNaN(v) && v > 0) onThresholdChange(v)
                  }
                }}
                style={inputStyle}
              />
              <button
                onClick={() => { const v = parseFloat(tempThreshold); if (!isNaN(v) && v > 0) onThresholdChange(v) }}
                style={btnStyle}
              >保存</button>
            </div>
            <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
              {[2, 4, 6, 8].map(h => (
                <button key={h} onClick={() => { onThresholdChange(h); setTempThreshold(String(h)) }} style={quickBtnStyle}>{h}h</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>空闲判定阈值（分钟）</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="number" min="1" max="60" step="1"
                value={tempIdleThreshold}
                onChange={(e) => setTempIdleThreshold(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat(tempIdleThreshold)
                    if (!isNaN(v) && v > 0) onIdleThresholdChange(v)
                  }
                }}
                style={inputStyle}
              />
              <button
                onClick={() => { const v = parseFloat(tempIdleThreshold); if (!isNaN(v) && v > 0) onIdleThresholdChange(v) }}
                style={btnStyle}
              >保存</button>
            </div>
            <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
              {[3, 5, 10, 15].map(m => (
                <button key={m} onClick={() => { onIdleThresholdChange(m); setTempIdleThreshold(String(m)) }} style={quickBtnStyle}>{m}m</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>喝水提醒间隔（分钟）</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="number" min="5" max="240" step="5"
                value={tempWaterInterval}
                onChange={(e) => setTempWaterInterval(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat(tempWaterInterval)
                    if (!isNaN(v) && v > 0) onWaterIntervalChange(v)
                  }
                }}
                style={inputStyle}
              />
              <button
                onClick={() => { const v = parseFloat(tempWaterInterval); if (!isNaN(v) && v > 0) onWaterIntervalChange(v) }}
                style={btnStyle}
              >保存</button>
            </div>
            <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
              {[15, 30, 45, 60].map(m => (
                <button key={m} onClick={() => { onWaterIntervalChange(m); setTempWaterInterval(String(m)) }} style={quickBtnStyle}>{m}m</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>每日喝水目标（杯）</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="number" min="1" max="20" step="1"
                value={tempWaterGoal}
                onChange={(e) => setTempWaterGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseInt(tempWaterGoal, 10)
                    if (!isNaN(v) && v > 0) onWaterGoalChange(v)
                  }
                }}
                style={inputStyle}
              />
              <button
                onClick={() => { const v = parseInt(tempWaterGoal, 10); if (!isNaN(v) && v > 0) onWaterGoalChange(v) }}
                style={btnStyle}
              >保存</button>
            </div>
            <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
              {[6, 8, 10, 12].map(c => (
                <button key={c} onClick={() => { onWaterGoalChange(c); setTempWaterGoal(String(c)) }} style={quickBtnStyle}>{c}杯</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const tabBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '12px',
  color: 'var(--dsh-fg-3, #999)',
  borderRadius: '4px',
}

const tabBtnActive: React.CSSProperties = {
  ...tabBtn,
  background: 'var(--dsh-fg-3, #eee)',
  color: 'var(--dsh-fg-1, #333)',
  fontWeight: 'bold',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: '12px',
  padding: '3px 6px',
  border: '1px solid var(--dsh-fg-3, #ccc)',
  borderRadius: '4px',
  background: 'var(--dsh-bg-1, #fff)',
  color: 'var(--dsh-fg-1, #333)',
  fontFamily: 'inherit',
}

const btnStyle: React.CSSProperties = {
  fontSize: '12px',
  padding: '3px 10px',
  border: '1px solid var(--dsh-fg-3, #ccc)',
  borderRadius: '4px',
  background: 'var(--dsh-bg-1, #fff)',
  color: 'var(--dsh-fg-1, #333)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const quickBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '2px 8px',
  fontSize: '11px',
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }): React.ReactElement {
  return (
    <div style={{ background: 'var(--dsh-fg-3, #f5f5f5)', borderRadius: '6px', padding: '8px' }}>
      <div style={{ fontSize: '11px', color: 'var(--dsh-fg-3, #999)' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 'bold', color: accent ?? 'var(--dsh-fg-1, #333)' }}>{value}</div>
    </div>
  )
}

/** client 半依赖注入声明：需要 slots 服务。 */
export const inject = ['slots']

/**
 * client 半 apply：把时钟注册到会话头部工具区（右上角，与导出日志等按钮并列）。
 * ctx 类型来自 @deepseek-ai/dsh-client-ui-slots，这里做最小化描述避免引入 peer 类型依赖。
 */
export function apply(ctx: {
  slots: {
    inject: (name: string, fn: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: React.ComponentType) => unknown
  }
}): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-office-helper',
    order: 100,
    inject: () => ({}),
  }, UtcClock))
}
