import { describe, expect, it } from "vitest";
import { deadline, timerAlert } from "./timerAlerts";
import type { PomodoroState } from "./types";
const now = Date.UTC(2026, 8, 19, 12);
const timer = (changes: Partial<PomodoroState> = {}): PomodoroState => ({
  room_id: "r",
  user_id: "ali",
  phase: "focus",
  run_state: "running",
  phase_started_at: new Date(now - 60000).toISOString(),
  remaining_ms: 60000,
  focus_minutes: 1,
  break_minutes: 1,
  focus_session_id: "s",
  updated_at: new Date(now - 60000).toISOString(),
  ...changes,
});
describe("timer alerts", () => {
  it("uses a timestamp deadline", () => expect(deadline(timer())).toBe(now));
  it("does not alert repeatedly on normal ticks", () =>
    expect(timerAlert(timer(), timer(), now - 1000)).toBeNull());
  it("uses one completion ID before and after server settlement", () => {
    const a = timerAlert(timer(), timer(), now);
    const b = timerAlert(
      timer(),
      timer({
        phase: "break",
        phase_started_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
      now + 1000,
    );
    expect(a?.complete).toBe(true);
    expect(a?.id).toBe(b?.id);
  });
  it("does not replay stale alarms after a long absence", () =>
    expect(timerAlert(timer(), timer(), now + 120000)).toBeNull());
  it("does not mistake a manual early stop for completion", () => {
    const next = timer({
      phase: "idle",
      run_state: "idle",
      phase_started_at: null,
      updated_at: new Date(now - 500).toISOString(),
    });
    expect(timerAlert(timer(), next, now)?.complete).toBe(false);
  });
  it("announces start and pause", () => {
    expect(
      timerAlert(
        undefined,
        timer({ updated_at: new Date(now).toISOString() }),
        now,
      )?.title,
    ).toContain("running");
    expect(
      timerAlert(
        timer(),
        timer({
          run_state: "paused",
          phase_started_at: null,
          updated_at: new Date(now - 500).toISOString(),
        }),
        now,
      )?.title,
    ).toBe("Focus paused.");
  });
  it("never expires a paused timer", () => {
    const paused = timer({ run_state: "paused", phase_started_at: null });
    expect(deadline(paused)).toBeNull();
    expect(timerAlert(paused, paused, now + 60000)).toBeNull();
  });
});
