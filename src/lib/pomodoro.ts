import type { PomodoroState } from "./types";

export function remaining(
  timer: PomodoroState | undefined,
  now: number,
): number {
  if (!timer) return 25 * 60000;
  return timer.run_state === "running" && timer.phase_started_at
    ? Math.max(
        0,
        timer.remaining_ms -
          Math.max(0, now - Date.parse(timer.phase_started_at)),
      )
    : timer.remaining_ms;
}

export function isFocusing(
  timer: PomodoroState | undefined,
  now: number,
): boolean {
  return Boolean(
    timer?.phase === "focus" &&
    timer.run_state === "running" &&
    timer.phase_started_at &&
    remaining(timer, now) > 0,
  );
}

// A resume updates phase_started_at, so this is the current uninterrupted overlap,
// independent of render cadence and separate from today's sum of all overlaps.
export function currentOverlap(timers: PomodoroState[], now: number): number {
  if (timers.length !== 2 || !timers.every((timer) => isFocusing(timer, now)))
    return 0;
  return Math.max(
    0,
    now -
      Math.max(...timers.map((timer) => Date.parse(timer.phase_started_at!))),
  );
}
