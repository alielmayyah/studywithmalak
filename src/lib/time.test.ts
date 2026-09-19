import { describe, expect, it } from 'vitest'
import { activeIntervals, calculateOverlap, localDayRange, totalTime } from './time'
import type { StudySession, StudyBreak } from './types'

const at = (h: number, m = 0) => Date.UTC(2026, 8, 19, h, m)
const interval = (a: number, b: number) => ({ start: at(a), end: at(b) })
const session = (start: number, end: number | null): StudySession => ({ id: 's', room_id: 'r', user_id: 'u', subject: null, started_at: new Date(at(start)).toISOString(), ended_at: end === null ? null : new Date(at(end)).toISOString(), created_at: new Date(at(start)).toISOString() })
const breakAt = (start: number, end: number | null): StudyBreak => ({ id: 'b', session_id: 's', started_at: new Date(at(start)).toISOString(), ended_at: end === null ? null : new Date(at(end)).toISOString(), created_at: new Date(at(start)).toISOString() })

describe('study time', () => {
  it('counts simultaneous study', () => expect(calculateOverlap([interval(8, 9)], [{ start: at(8, 20), end: at(9, 10) }])).toBe(40 * 60000))
  it('excludes breaks and resumes', () => {
    const a = activeIntervals(session(8, 10), [breakAt(8, 9)], at(10))
    expect(totalTime(a)).toBe(60 * 60000)
    expect(calculateOverlap(a, [interval(9, 10)])).toBe(60 * 60000)
  })
  it('stops an open break', () => expect(totalTime(activeIntervals(session(8, null), [breakAt(9, null)], at(10)))).toBe(60 * 60000))
  it('keeps an ongoing session advancing from timestamps', () => {
    expect(totalTime(activeIntervals(session(8, null), [], at(9)))).toBe(3600000)
    expect(totalTime(activeIntervals(session(8, null), [], at(10)))).toBe(7200000)
  })
  it('handles repeated and overlapping break records without double subtraction', () => {
    const breaks = [breakAt(8, 9), { ...breakAt(8, 10), id: 'b2' }]
    expect(totalTime(activeIntervals(session(8, 11), breaks, at(11)))).toBe(3600000)
  })
  it('handles empty and adjacent intervals', () => {
    expect(calculateOverlap([], [interval(8, 9)])).toBe(0)
    expect(calculateOverlap([interval(8, 9)], [interval(9, 10)])).toBe(0)
  })
  it('handles multiple intervals and simultaneous starts', () => {
    expect(calculateOverlap([interval(8, 9), interval(10, 11)], [interval(8, 11)])).toBe(2 * 3600000)
  })
  it('clips across midnight', () => {
    const day = localDayRange(new Date(2026, 8, 19, 12))
    const crossing = { ...session(8, 10), started_at: new Date(day.start - 3600000).toISOString(), ended_at: new Date(day.start + 3600000).toISOString() }
    expect(totalTime(activeIntervals(crossing, [], day.end, day))).toBe(3600000)
  })
})
