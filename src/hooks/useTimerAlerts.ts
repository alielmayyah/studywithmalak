import { useEffect, useRef, useState } from "react";
import type { PomodoroState } from "../lib/types";
import {
  deadline,
  playChime,
  timerAlert,
  unlockAudio,
} from "../lib/timerAlerts";
import type { TimerAlert } from "../lib/timerAlerts";
import { formatCountdown } from "../lib/time";
import { remaining } from "../lib/pomodoro";
import {
  getPushStatus,
  pushSupported as isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "../lib/pushSubscription";

function read(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing may disable storage. */
  }
}

export function useTimerAlerts(
  timer: PomodoroState | undefined,
  now: number,
  userId: string,
) {
  const [sound, setSoundState] = useState(
    () => read("study-sound", "true") === "true",
  );
  const [volume, setVolumeState] = useState(() => {
    const value = Number(read("study-volume", ".4"));
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.4;
  });
  const [desktop, setDesktop] = useState(
    () => read("study-desktop", "true") === "true",
  );
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    "Notification" in window && window.isSecureContext
      ? Notification.permission
      : "unsupported",
  );
  const [notice, setNotice] = useState<TimerAlert | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [returnReminder, setReturnReminder] = useState(
    () => deadline(timer) !== null && remaining(timer, now) > 0,
  );
  const [push, setPush] = useState(false);
  const [pushError, setPushError] = useState("");
  const pushChecked = useRef(false);
  const previous = useRef(timer);
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const seen = useRef(new Set<string>());

  // Check push subscription status on mount and auto-subscribe if permission already granted
  useEffect(() => {
    if (pushChecked.current) return;
    pushChecked.current = true;
    void getPushStatus(userId).then((active) => {
      setPush(active);
      if (!isPushSupported()) return;

      if ("Notification" in window && Notification.permission === "granted") {
        // Permission is already granted — enable phone push notifications automatically!
        void subscribeToPush(userId).then((ep) => {
          if (ep) {
            setPush(true);
            setDesktop(true);
            save("study-desktop", "true");
          }
        });
      }
    });
  }, [userId]);

  useEffect(() => {
    const unlock = () => {
      if (sound) unlockAudio();
    };
    const visible = () => {
      if (document.visibilityState === "visible") {
        if (
          deadline(timerRef.current) !== null &&
          remaining(timerRef.current, Date.now()) > 0
        )
          setReturnReminder(true);
        if ("Notification" in window) setPermission(Notification.permission);
      }
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [sound]);

  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    document.title =
      timer && timer.phase !== "idle"
        ? `${formatCountdown(remaining(timer, now))} · ${timer.run_state === "paused" ? "Paused" : timer.phase === "break" ? "Break" : "Focus"} | Ali × Malak`
        : "Ali × Malak";
  }, [timer, now]);

  useEffect(() => {
    const event = timerAlert(previous.current, timer, now);
    previous.current = timer;
    if (!event || seen.current.has(event.id)) return;
    seen.current.add(event.id);
    if (seen.current.size > 32)
      seen.current.delete(seen.current.values().next().value!);
    setNotice(event);
    const deliver = () => {
      // A shared lock plus persistent event ID prevents duplicate sounds across tabs.
      const key = `study-alert:${userId}`;
      if (read(key, "") === event.id) return;
      save(key, event.id);
      if (sound) playChime(volume, event.complete);
      if (desktop && permission === "granted") {
        try {
          const notification = new Notification(event.title, {
            body: event.body,
            tag: event.id,
            silent: true,
            icon: `${import.meta.env.BASE_URL}avatars/ali.webp`,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        } catch {
          setNotificationError(
            "Desktop alerts are unavailable here. In-app reminders and sounds still work.",
          );
        }
      }
    };
    if (navigator.locks)
      void navigator.locks
        .request(`study-alert:${userId}`, deliver)
        .catch(() => {});
    else deliver();
  }, [timer, now, sound, volume, desktop, permission, userId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function setSound(value: boolean) {
    setSoundState(value);
    save("study-sound", String(value));
    if (value) unlockAudio();
  }
  function setVolume(value: number) {
    setVolumeState(value);
    save("study-volume", String(value));
  }
  async function toggleDesktop() {
    setNotificationError("");
    if (desktop) {
      setDesktop(false);
      save("study-desktop", "false");
      return;
    }
    if (!("Notification" in window) || !window.isSecureContext) return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      setDesktop(result === "granted");
      save("study-desktop", String(result === "granted"));
      if (result === "denied")
        setNotificationError(
          "Notifications are blocked. Allow them in your browser's site settings, then try again.",
        );
    } catch {
      setNotificationError("This browser cannot enable desktop notifications.");
    }
  }
  async function togglePush() {
    setPushError("");
    if (push) {
      const ok = await unsubscribeFromPush(userId);
      if (ok) setPush(false);
      else setPushError("Could not disable phone notifications.");
      return;
    }
    const endpoint = await subscribeToPush(userId);
    if (endpoint) {
      setPush(true);
      setDesktop(true);
      save("study-desktop", "true");
    } else {
      setPushError(
        Notification.permission === "denied"
          ? "Notifications are blocked. Allow them in your browser's site settings, then try again."
          : "Could not enable phone notifications. On iPhone, add the app to your Home Screen first.",
      );
    }
  }
  return {
    sound,
    setSound,
    volume,
    setVolume,
    desktop: desktop && permission === "granted",
    permission,
    toggleDesktop,
    push,
    pushSupported: isPushSupported(),
    togglePush,
    pushError,
    notificationError,
    notice,
    dismissNotice: () => setNotice(null),
    returnReminder:
      returnReminder && deadline(timer) !== null && remaining(timer, now) > 0,
    dismissReturn: () => setReturnReminder(false),
    testSound: () => {
      unlockAudio();
      window.setTimeout(() => playChime(volume, true), 100);
    },
  };
}
