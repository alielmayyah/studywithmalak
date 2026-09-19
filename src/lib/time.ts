import type { StudyBreak, StudySession } from './types'

export type Interval = { start: number; end: number }

export function activeIntervals(session: StudySession, breaks: StudyBreak[], now: number, range?: Interval): Interval[] {
  const start = Math.max(Date.parse(session.started_at), range?.start ?? -Infinity)
  const end = Math.min(session.ended_at ? Date.parse(session.ended_at) : now, range?.end ?? Infinity)
  if (end <= start) return []
  const ordered = breaks.filter(b => b.session_id === session.id).map(b => ({
    start: Math.max(start, Date.parse(b.started_at)),
    end: Math.min(end, b.ended_at ? Date.parse(b.ended_at) : now),
  })).filter(b => b.end > b.start).sort((a, b) => a.start - b.start)
  const intervals: Interval[] = []
  let cursor = start
  for (const b of ordered) {
    if (b.start > cursor) intervals.push({ start: cursor, end: b.start })
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < end) intervals.push({ start: cursor, end })
  return intervals
}

export function calculateOverlap(a: Interval[], b: Interval[]): number {
  const aa = [...a].sort((x, y) => x.start - y.start)
  const bb = [...b].sort((x, y) => x.start - y.start)
  let i = 0, j = 0, total = 0
  while (i < aa.length && j < bb.length) {
    total += Math.max(0, Math.min(aa[i].end, bb[j].end) - Math.max(aa[i].start, bb[j].start))
    if (aa[i].end <= bb[j].end) i++
    else j++
  }
  return total
}

export function totalTime(intervals: Interval[]): number { return intervals.reduce((sum, i) => sum + i.end - i.start, 0) }
export function formatClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':')
}
export function formatShort(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
export function localDayRange(now: Date): Interval {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return { start, end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() }
}
