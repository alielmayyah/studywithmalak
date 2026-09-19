import { describe, expect, it } from "vitest";
import { currentOverlap, isFocusing, remaining } from "./pomodoro";
import type { PomodoroState } from "./types";

const now = Date.UTC(2026, 8, 19, 9);
const timer = (
  ago: number,
  overrides: Partial<PomodoroState> = {},
): PomodoroState => ({
  room_id: "room",
  user_id: "ali",
  phase: "focus",
  run_state: "running",
  phase_started_at: new Date(now - ago).toISOString(),
  remaining_ms: 25 * 60000,
  focus_minutes: 25,
  break_minutes: 5,
  focus_session_id: "session",
  updated_at: new Date(now).toISOString(),
  ...overrides,
});

describe("timestamp-driven Pomodoro presentation", () => {
  it("restores the same remaining time after refresh and elapsed time", () => {
    const saved = timer(5 * 60000);
    expect(remaining(JSON.parse(JSON.stringify(saved)), now)).toBe(20 * 60000);
    expect(remaining(saved, now + 60000)).toBe(19 * 60000);
  });
  it("does not decrement paused time", () => {
    expect(
      remaining(
        timer(60000, {
          run_state: "paused",
          phase_started_at: null,
          remaining_ms: 42000,
        }),
        now + 3600000,
      ),
    ).toBe(42000);
  });
  it("does not count expired focus while waiting for a server refresh", () => {
    const expired = timer(26 * 60000);
    expect(remaining(expired, now)).toBe(0);
    expect(isFocusing(expired, now)).toBe(false);
    expect(currentOverlap([expired, timer(60000)], now)).toBe(0);
  });
  it("uses the later start for the current shared session", () => {
    expect(currentOverlap([timer(10 * 60000), timer(3 * 60000)], now)).toBe(
      3 * 60000,
    );
  });
  it("stops during pause and resets the shared segment on resume", () => {
    expect(
      currentOverlap(
        [timer(600000), timer(60000, { run_state: "paused" })],
        now,
      ),
    ).toBe(0);
    expect(currentOverlap([timer(600000), timer(10000)], now)).toBe(10000);
  });
  it("requires exactly two active focus timers, not a manually selected focus status", () => {
    expect(currentOverlap([timer(60000)], now)).toBe(0);
    expect(
      currentOverlap([timer(60000), timer(60000, { phase: "break" })], now),
    ).toBe(0);
    expect(isFocusing(undefined, now)).toBe(false);
  });
});
