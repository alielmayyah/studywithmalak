import type { PomodoroState } from "./types";

export type TimerAlert = {
  id: string;
  title: string;
  body: string;
  complete: boolean;
};
export function deadline(timer?: PomodoroState): number | null {
  return timer?.run_state === "running" && timer.phase_started_at
    ? Date.parse(timer.phase_started_at) + timer.remaining_ms
    : null;
}

// Only emit a recent completion; reopening days later must not replay old alarms.
export function timerAlert(
  previous: PomodoroState | undefined,
  next: PomodoroState | undefined,
  now: number,
): TimerAlert | null {
  const end = deadline(previous);
  const changed = previous?.updated_at !== next?.updated_at;
  const stoppedEarly =
    changed && next && Date.parse(next.updated_at) < (end ?? Infinity);
  if (
    previous &&
    end !== null &&
    now >= end &&
    now - end < 60000 &&
    !stoppedEarly
  ) {
    return {
      id: `${previous.user_id}:${previous.phase}:${end}`,
      title:
        previous.phase === "focus"
          ? "Focus complete. Take a breath."
          : "Your break is over.",
      body:
        previous.phase === "focus"
          ? "Your focus time is saved. Time for a little rest."
          : "Ready for another focus session?",
      complete: true,
    };
  }
  if (
    !next ||
    !changed ||
    (next.phase === previous?.phase && next.run_state === previous?.run_state)
  )
    return null;
  if (now - Date.parse(next.updated_at) > 60000) return null;
  const title =
    next.phase === "idle"
      ? "Session ended."
      : next.run_state === "paused"
        ? "Focus paused."
        : next.phase === "break"
          ? "Break timer is running."
          : previous?.run_state === "paused"
            ? "Focus resumed."
            : "Your focus timer is running.";
  return {
    id: `${next.user_id}:${next.updated_at}:${next.phase}:${next.run_state}`,
    title,
    body:
      next.run_state === "running"
        ? "Your timer keeps counting if you close the browser."
        : "Your progress is saved.",
    complete: false,
  };
}

let audio: AudioContext | undefined;
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch {
    /* Audio is optional on unsupported browsers. */
  }
}
export function playChime(volume: number, complete = false) {
  if (!audio || audio.state !== "running") return;
  const context = audio;
  const notes = complete ? [523.25, 659.25, 783.99] : [523.25, 659.25];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    const start = context.currentTime + index * 0.16;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(1, volume)) * 0.18,
      start + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.6);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  });
}
