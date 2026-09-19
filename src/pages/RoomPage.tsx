import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Check,
  ChevronDown,
  Heart,
  History,
  LogOut,
  Pause,
  Play,
  Settings,
  Smartphone,
  WifiOff,
  Bell,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useRoom } from "../hooks/useRoom";
import type { RoomData } from "../hooks/useRoom";
import { useClock } from "../hooks/useClock";
import { useTimerAlerts } from "../hooks/useTimerAlerts";
import {
  activeIntervals,
  calculateOverlap,
  formatCountdown,
  formatMinutes,
  localDayRange,
  totalTime,
} from "../lib/time";
import { currentOverlap, remaining, isFocusing } from "../lib/pomodoro";
import { supabase } from "../lib/supabase";
import { avatarUrl } from "../lib/avatars";
import type { PomodoroState, Profile, UserStatus } from "../lib/types";
import "./room.css";

const statuses = [
  { value: "focus", label: "Focus", emoji: "📚" },
  { value: "break", label: "Break", emoji: "☕" },
  { value: "eating", label: "Eating", emoji: "🍽️" },
  { value: "away", label: "Away", emoji: "🚶" },
  { value: "done", label: "Done", emoji: "😴" },
] as const;

// The connected page owns persistence; the view receives authoritative snapshots.
export function RoomPage({ userId }: { userId: string }) {
  const room = useRoom(userId);
  const now = useClock();
  if (room.loading && !room.data)
    return (
      <div className="loading-screen" role="status">
        Opening your room…
      </div>
    );
  if (!room.data)
    return (
      <main className="empty-screen">
        <h1>We couldn’t open the room.</h1>
        <p>{room.error}</p>
        <button className="primary" onClick={() => void room.reload()}>
          Try again
        </button>
        <button
          className="text-button"
          onClick={() => void supabase.auth.signOut()}
        >
          Sign out
        </button>
      </main>
    );
  if (!room.data.profiles.some((p) => p.id === userId))
    return (
      <main className="empty-screen">
        <h1>Account not set up</h1>
        <p>Your account needs a profile in this room.</p>
        <button
          className="secondary"
          onClick={() => void supabase.auth.signOut()}
        >
          Sign out
        </button>
      </main>
    );
  return <RoomView {...room} data={room.data} userId={userId} now={now} />;
}

type RoomViewProps = {
  data: RoomData;
  userId: string;
  now: number;
  online: string[];
  presenceReady: boolean;
  connected: boolean;
  error: string;
  reload: () => Promise<void>;
};

export function RoomView({
  data,
  userId,
  now,
  online,
  presenceReady,
  connected,
  error,
  reload,
}: RoomViewProps) {
  const [busy, setBusy] = useState(false);
  const commandPending = useRef(false);
  const [actionError, setActionError] = useState("");
  const ownTimer = data.timers.find((t) => t.user_id === userId);
  const alerts = useTimerAlerts(ownTimer, now, userId);
  const [preset, setPreset] = useState(() => {
    const f = ownTimer?.focus_minutes ?? 25,
      b = ownTimer?.break_minutes ?? 5;
    return f === 25 && b === 5
      ? "25/5"
      : f === 50 && b === 10
        ? "50/10"
        : "Custom";
  });
  const [focusMinutes, setFocusMinutes] = useState(
    ownTimer?.focus_minutes ?? 25,
  );
  const [breakMinutes, setBreakMinutes] = useState(
    ownTimer?.break_minutes ?? 5,
  );
  const [quiet, setQuiet] = useState(
    () => localStorage.getItem("study-quiet") === "true",
  );
  const profiles = [...data.profiles].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
  const me = profiles.find((p) => p.id === userId)!;
  const partner = profiles.find((p) => p.id !== userId);
  const partnerTimer = data.timers.find((t) => t.user_id === partner?.id);
  const partnerStatus =
    data.statuses.find((s) => s.user_id === partner?.id)?.status || "away";
  const day = localDayRange(new Date(now));
  const intervals = profiles.map((profile) =>
    data.sessions
      .filter((s) => s.user_id === profile.id)
      .flatMap((s) => {
        const timer = data.timers.find((t) => t.focus_session_id === s.id);
        const cap =
          timer?.run_state === "running" && timer.phase_started_at
            ? Date.parse(timer.phase_started_at) + timer.remaining_ms
            : undefined;
        return activeIntervals(s, data.breaks, now, day, cap);
      }),
  );
  const totals = intervals.map(totalTime);
  const together =
    intervals.length === 2 ? calculateOverlap(intervals[0], intervals[1]) : 0;
  const bothFocusing =
    profiles.length === 2 &&
    profiles.every((p) =>
      isFocusing(
        data.timers.find((t) => t.user_id === p.id),
        now,
      ),
    );
  const sharedSession = bothFocusing ? currentOverlap(data.timers, now) : 0;
  const bothOnline =
    presenceReady &&
    profiles.length === 2 &&
    profiles.every((p) => online.includes(p.id));
  const idle = !ownTimer || ownTimer.phase === "idle";
  const paused = ownTimer?.run_state === "paused";
  const onBreak = ownTimer?.phase === "break";
  const timeLeft = idle ? focusMinutes * 60000 : remaining(ownTimer, now);
  const duration =
    (idle
      ? focusMinutes
      : onBreak
        ? ownTimer.break_minutes
        : ownTimer.focus_minutes) * 60000;
  const progress =
    duration > 0 ? Math.max(0, Math.min(1, timeLeft / duration)) : 0;
  const validDuration =
    Number.isInteger(focusMinutes) &&
    focusMinutes >= 1 &&
    focusMinutes <= 180 &&
    Number.isInteger(breakMinutes) &&
    breakMinutes >= 1 &&
    breakMinutes <= 60;
  const partnerName = partner?.display_name || "Your partner";
  const partnerFocusing = isFocusing(partnerTimer, now);
  const context = !connected
    ? "Your timers are saved. Reconnecting…"
    : !presenceReady
      ? "Connecting to your shared room…"
      : partner && !online.includes(partner.id)
        ? `${partnerName} is offline. Your space is ready.`
        : partnerFocusing
          ? `${partnerName} is focusing. ${idle ? `Join ${partnerName}.` : "Find your rhythm."}`
          : partnerStatus === "break"
            ? onBreak
              ? "Both taking a break."
              : `${partnerName} is taking a break ☕`
            : partnerStatus === "eating"
              ? `${partnerName} is having a bite 🍽️`
              : partnerStatus === "done"
                ? `${partnerName} is done for today.`
                : together > 0
                  ? "A little time, well spent together."
                  : "Start when you’re both ready.";

  async function command(action: string, status?: UserStatus["status"]) {
    if (commandPending.current || !connected) return;
    commandPending.current = true;
    setBusy(true);
    setActionError("");
    try {
      const run = async (next: string) => {
        const { error: cause } = await supabase.rpc("pomodoro_command", {
          p_room: data.room.id,
          p_action: next,
          p_focus_minutes:
            next === "start"
              ? action === "back_to_focus"
                ? (ownTimer?.focus_minutes ?? focusMinutes)
                : focusMinutes
              : null,
          p_break_minutes:
            next === "start"
              ? action === "back_to_focus"
                ? (ownTimer?.break_minutes ?? breakMinutes)
                : breakMinutes
              : null,
          p_status: status || null,
        });
        if (cause) throw cause;
      };
      if (action === "back_to_focus") {
        await run("skip_break");
        await run("start");
      } else await run(action);
      await reload();
      alerts.dismissReturn();
    } catch {
      setActionError("Could not save that change. Please try again.");
      await reload();
    } finally {
      commandPending.current = false;
      setBusy(false);
    }
  }
  function selectPreset(value: string) {
    setPreset(value);
    if (value === "25/5") {
      setFocusMinutes(25);
      setBreakMinutes(5);
    }
    if (value === "50/10") {
      setFocusMinutes(50);
      setBreakMinutes(10);
    }
  }
  function person(profile: Profile) {
    const index = profiles.indexOf(profile);
    return (
      <Person
        key={profile.id}
        profile={profile}
        online={presenceReady && connected ? online.includes(profile.id) : null}
        status={
          data.statuses.find((s) => s.user_id === profile.id)?.status || "away"
        }
        timer={data.timers.find((t) => t.user_id === profile.id)}
        isMe={profile.id === userId}
        total={totals[index] || 0}
        onStatus={(status) => void command("status", status)}
        busy={busy || !connected}
        now={now}
      />
    );
  }
  const activePreset = idle
    ? preset
    : ownTimer.focus_minutes === 25 && ownTimer.break_minutes === 5
      ? "25/5"
      : ownTimer.focus_minutes === 50 && ownTimer.break_minutes === 10
        ? "50/10"
        : "Custom";

  return (
    <div
      className={`app-shell room-shell theme-${me.display_name.toLowerCase()} ${quiet ? "quiet-room" : ""}`}
    >
      <header className="site-header">
        <Link className="brand" to="/">
          ALI <span>×</span> MALAK
        </Link>
        <time
          className="header-center"
          dateTime={format(new Date(now), "yyyy-MM-dd")}
        >
          {format(new Date(now), "EEEE, MMMM d")}
        </time>
        <nav aria-label="Main navigation">
          <Link
            className="icon-button"
            to="/history"
            aria-label="Study history"
            title="History"
          >
            <History size={18} />
          </Link>
          <RoomSettings
            alerts={alerts}
            quiet={quiet}
            setQuiet={(value) => {
              setQuiet(value);
              localStorage.setItem("study-quiet", String(value));
            }}
          />
          <button
            className="icon-button"
            onClick={() => void supabase.auth.signOut()}
            aria-label="Sign out / switch user"
            title="Switch user"
          >
            <LogOut size={18} />
          </button>
        </nav>
      </header>
      {!connected && (
        <div className="connection" role="status">
          <WifiOff size={16} /> Reconnecting… Your timer is saved.
        </div>
      )}
      {error && (
        <div className="connection" role="alert">
          {error} <button onClick={() => void reload()}>Retry</button>
        </div>
      )}
      <main className="room-main">
        {alerts.returnReminder && (
          <section
            className="timer-reminder"
            aria-label="Running timer reminder"
          >
            <Bell size={18} aria-hidden="true" />
            <div>
              <strong>
                Your {onBreak ? "break" : "focus"} timer is still running.
              </strong>
              <p>
                It kept counting while you were away. Continue or end the
                session.
              </p>
            </div>
            <button className="secondary" onClick={alerts.dismissReturn}>
              Continue
            </button>
            <button
              className="text-button"
              disabled={busy || !connected}
              onClick={() => void command("end")}
            >
              End session
            </button>
          </section>
        )}
        <section className="room-heading">
          <div className="eyebrow">OUR STUDY ROOM</div>
          <h1>
            {bothFocusing
              ? "Together now."
              : bothOnline
                ? "Here together."
                : "Your quiet corner."}
          </h1>
          <p>Every minute together counts.</p>
        </section>
        <section className="live-room" aria-label="Your shared study room">
          {profiles[0] && person(profiles[0])}
          <div
            className={`together-hero ${bothFocusing ? "active" : ""}`}
            aria-label="Together time"
          >
            <div className="together-halo" aria-hidden="true" />
            <div className="together-label">
              {bothFocusing && <i aria-hidden="true" />}
              {bothFocusing ? "TOGETHER NOW" : "TOGETHER TODAY"}
            </div>
            <strong className="together-value">
              {bothFocusing
                ? formatCountdown(sharedSession)
                : formatMinutes(together)}
            </strong>
            <p className="together-caption">
              {bothFocusing
                ? `Today · ${formatMinutes(together)} together`
                : context}
            </p>
            <div className="pair-chip">
              <span className="mini-avatars" aria-hidden="true">
                <img src={avatarUrl("Ali")} alt="" />
                <img src={avatarUrl("Malak")} alt="" />
              </span>
              {bothFocusing
                ? "Both active"
                : bothOnline
                  ? "In good company"
                  : "A space for two"}
            </div>
            {idle && partnerFocusing && (
              <button
                className="primary join-button"
                disabled={busy || !connected || !validDuration}
                onClick={() => void command("start")}
              >
                <Play size={13} /> Start focus
              </button>
            )}
          </div>
          {profiles[1] && person(profiles[1])}
        </section>
        <section
          className="timer-panel"
          aria-labelledby="pomodoro-heading"
          id="pomodoro"
        >
          <div className="timer-panel-heading">
            <h2 className="eyebrow" id="pomodoro-heading">
              YOUR POMODORO
            </h2>
            <span className="timer-owner">
              <img src={avatarUrl(me.display_name)} alt="" />
              {me.display_name}’s time
            </span>
          </div>
          <div className="timer-awareness">
            <span>
              {idle
                ? "Ready when you are"
                : paused
                  ? "Timer paused"
                  : timeLeft <= 0
                    ? "Session complete"
                    : `${onBreak ? "Break" : "Focus"} timer running`}
            </span>
            <button
              className="icon-button"
              aria-label={
                alerts.sound ? "Mute timer sounds" : "Enable timer sounds"
              }
              aria-pressed={alerts.sound}
              onClick={() => alerts.setSound(!alerts.sound)}
            >
              {alerts.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
          <div className="timer-content">
            <div
              className={`timer-dial ${onBreak ? "is-break" : ""}`}
              aria-label={`${paused ? "Paused" : onBreak ? "Break" : idle ? "Ready" : "Focus"} timer: ${formatCountdown(timeLeft)} remaining`}
            >
              <svg viewBox="0 0 250 250" aria-hidden="true">
                <circle className="ring-track" cx="125" cy="125" r="115" />
                <circle
                  className="ring-progress"
                  cx="125"
                  cy="125"
                  r="115"
                  strokeDasharray={2 * Math.PI * 115}
                  strokeDashoffset={2 * Math.PI * 115 * (1 - progress)}
                />
              </svg>
              <div className="dial-copy">
                <span className="dial-emoji" aria-hidden="true">
                  {onBreak ? "☕" : "📚"}
                </span>
                <span className="dial-label">
                  {paused
                    ? "PAUSED"
                    : onBreak
                      ? "BREAK"
                      : idle
                        ? "YOUR NEXT FOCUS"
                        : timeLeft === 0
                          ? "COMPLETED"
                          : "FOCUS"}
                </span>
                <strong>{formatCountdown(timeLeft)}</strong>
                <small>
                  {idle
                    ? "Ready when you are."
                    : paused
                      ? "Take your time."
                      : timeLeft === 0
                        ? "Syncing your next phase…"
                        : "remaining"}
                </small>
              </div>
            </div>
            <div className="timer-controls">
              <div className="eyebrow">TIMER PRESETS</div>
              <div
                className="presets"
                role="group"
                aria-label="Focus and break duration"
              >
                {["25/5", "50/10", "Custom"].map((value) => (
                  <button
                    key={value}
                    disabled={!idle || busy}
                    aria-pressed={activePreset === value}
                    className={activePreset === value ? "selected" : ""}
                    onClick={() => selectPreset(value)}
                  >
                    {value.replace("/", " / ")}
                  </button>
                ))}
              </div>
              {idle && preset === "Custom" && (
                <div className="custom-times">
                  <label>
                    Focus minutes
                    <input
                      type="number"
                      min="1"
                      max="180"
                      step="1"
                      value={focusMinutes || ""}
                      onChange={(e) => setFocusMinutes(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Break minutes
                    <input
                      type="number"
                      min="1"
                      max="60"
                      step="1"
                      value={breakMinutes || ""}
                      onChange={(e) => setBreakMinutes(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
              <p className="timer-hint">
                {idle
                  ? "A little focus. A little rest. Your own rhythm."
                  : paused
                    ? "Your progress is saved. Pick up where you left off."
                    : onBreak
                      ? "Rest your eyes. Come back when you’re ready."
                      : `${ownTimer.focus_minutes} minutes of focus, then ${ownTimer.break_minutes} minutes to breathe.`}
              </p>
              {!idle && !paused && (
                <p className="timer-away-note">
                  Closing the browser does not stop your timer.
                </p>
              )}
              <div className="timer-actions">
                <button
                  className="primary"
                  disabled={busy || !connected || !validDuration}
                  onClick={() =>
                    void command(
                      idle
                        ? "start"
                        : onBreak
                          ? "back_to_focus"
                          : paused
                            ? "resume"
                            : "pause",
                    )
                  }
                >
                  {!idle && !onBreak && !paused ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}{" "}
                  {busy
                    ? "Saving…"
                    : idle
                      ? "Start focus"
                      : onBreak
                        ? "Resume focus"
                        : paused
                          ? "Resume focus"
                          : "Pause"}
                </button>
                {!idle && (
                  <button
                    className="secondary"
                    disabled={busy || !connected}
                    onClick={() => void command("end")}
                  >
                    End session
                  </button>
                )}
              </div>
              {!idle && !onBreak && (
                <button
                  className="text-button break-action"
                  disabled={busy || !connected}
                  onClick={() => void command("break")}
                >
                  Take a break
                </button>
              )}
            </div>
          </div>
        </section>
        {actionError && (
          <p className="error room-error" role="alert">
            {actionError}
          </p>
        )}
        <section className="today-strip" aria-label="Focus time today">
          <h2 className="eyebrow">TODAY</h2>
          {[me, partner]
            .filter((p): p is Profile => Boolean(p))
            .map((profile) => (
              <div
                className={`today-stat ${profile.display_name.toLowerCase()}`}
                key={profile.id}
              >
                <span>
                  {profile.id === userId
                    ? "YOU"
                    : profile.display_name.toUpperCase()}
                </span>
                <strong>
                  {formatMinutes(totals[profiles.indexOf(profile)] || 0)}
                </strong>
              </div>
            ))}
          <div className="today-stat pair">
            <span>
              <Heart aria-hidden="true" /> TOGETHER
            </span>
            <strong>{formatMinutes(together)}</strong>
          </div>
        </section>
        <footer className="room-footer">Same goals. Brighter days.</footer>
      </main>
      <div
        className="timer-toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {alerts.notice && (
          <div className="timer-toast">
            <Bell size={18} aria-hidden="true" />
            <div>
              <strong>{alerts.notice.title}</strong>
              <p>{alerts.notice.body}</p>
            </div>
            <button
              className="icon-button"
              aria-label="Dismiss timer notification"
              onClick={alerts.dismissNotice}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Person({
  profile,
  online,
  status,
  timer,
  isMe,
  total,
  onStatus,
  busy,
  now,
}: {
  profile: Profile;
  online: boolean | null;
  status: UserStatus["status"];
  timer?: PomodoroState;
  isMe: boolean;
  total: number;
  onStatus: (status: UserStatus["status"]) => void;
  busy: boolean;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    wrap.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const current = statuses.find((s) => s.value === status) || statuses[3];
  const active = timer && timer.phase !== "idle";
  return (
    <article
      className={`person-card person-${profile.display_name.toLowerCase()} ${isMe ? "is-me" : ""}`}
      aria-label={`${profile.display_name}${isMe ? ", you" : ""}`}
    >
      <div className="avatar">
        <img
          src={avatarUrl(profile.display_name)}
          alt={`${profile.display_name}’s avatar`}
        />
        <i
          className={`presence-dot ${online ? "online" : ""}`}
          aria-hidden="true"
        />
      </div>
      <div className="person-name">
        <h2>
          {profile.display_name}
          {isMe && <span>(you)</span>}
        </h2>
        <div className="presence-label">
          {online === null ? "Connecting…" : online ? "Online" : "Offline"}
          {online === false &&
            timer?.run_state === "running" &&
            remaining(timer, now) > 0 && (
              <span className="offline-timer-note">
                {timer.phase === "break" ? "Break" : "Focus"} timer running
              </span>
            )}
        </div>
      </div>
      <div
        className="status-wrap"
        ref={wrap}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            trigger.current?.focus();
          }
          if (
            open &&
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            const options = Array.from(
              wrap.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemradio"]',
              ) || [],
            );
            const index = options.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            options[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length
            ]?.focus();
          }
        }}
      >
        {isMe ? (
          <>
            <button
              ref={trigger}
              className="person-status"
              disabled={busy}
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-haspopup="menu"
              aria-label={`Change your status, currently ${current.label}`}
            >
              <span aria-hidden="true">{current.emoji}</span>
              {current.label}
              <ChevronDown size={12} />
            </button>
            {open && (
              <div className="status-menu" role="menu" aria-label="Your status">
                {statuses.map((item) => (
                  <button
                    role="menuitemradio"
                    aria-checked={status === item.value}
                    key={item.value}
                    disabled={busy}
                    onClick={() => {
                      onStatus(item.value);
                      setOpen(false);
                      trigger.current?.focus();
                    }}
                  >
                    <span aria-hidden="true">{item.emoji}</span>
                    {item.label}
                    {status === item.value && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="person-status">
            <span aria-hidden="true">{current.emoji}</span>
            {current.label}
          </div>
        )}
      </div>
      <div className="person-stats">
        <div>
          <strong>
            {active ? formatCountdown(remaining(timer, now)) : "Ready"}
          </strong>
          <small>
            {active
              ? timer.run_state === "paused"
                ? "focus paused"
                : timer.phase === "break"
                  ? "break remaining"
                  : "focus remaining"
              : "no active timer"}
          </small>
        </div>
        <div>
          <strong>{formatMinutes(total)}</strong>
          <small>focus today</small>
        </div>
      </div>
    </article>
  );
}

function RoomSettings({
  quiet,
  setQuiet,
  alerts,
}: {
  quiet: boolean;
  setQuiet: (value: boolean) => void;
  alerts: ReturnType<typeof useTimerAlerts>;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    wrap.current?.querySelector("input")?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="settings-wrap"
      ref={wrap}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="icon-button"
        aria-label="Room settings"
        aria-expanded={open}
        aria-controls="room-settings"
        onClick={() => setOpen(!open)}
        title="Settings"
      >
        <Settings size={18} />
      </button>
      {open && (
        <div className="settings-popover" id="room-settings">
          <h2>Make yourself at home.</h2>
          <p>A small preference for this device.</p>
          <div className="alert-settings">
            <label>
              <input
                type="checkbox"
                checked={alerts.sound}
                onChange={(event) => alerts.setSound(event.target.checked)}
              />{" "}
              Timer sounds
            </label>
            <label className="volume-label">
              Volume
              <input
                aria-label="Timer sound volume"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={alerts.volume}
                disabled={!alerts.sound}
                onChange={(event) =>
                  alerts.setVolume(Number(event.target.value))
                }
              />
            </label>
            <button
              className="secondary"
              disabled={!alerts.sound}
              onClick={alerts.testSound}
            >
              <Volume2 size={14} /> Test sound
            </button>
            <button
              className="secondary"
              disabled={alerts.permission === "unsupported"}
              onClick={() => void alerts.toggleDesktop()}
            >
              <Bell size={14} />
              {alerts.desktop
                ? "Disable desktop alerts"
                : "Enable desktop alerts"}
            </button>
            {alerts.pushSupported && (
              <button
                className="secondary"
                onClick={() => void alerts.togglePush()}
              >
                <Smartphone size={14} />
                {alerts.push
                  ? "Disable phone notifications"
                  : "Enable phone notifications"}
              </button>
            )}
            <p>
              {alerts.permission === "unsupported"
                ? "Desktop notifications are not supported in this browser."
                : alerts.push
                  ? "Phone notifications are active. You\u2019ll be notified even after closing the browser."
                  : "Desktop alerts work while this room is open. Enable phone notifications to get reminders after closing the browser."}
            </p>
            {alerts.pushSupported && !alerts.push && (
              <p className="push-hint">
                On iPhone, first add the app to your Home Screen (Share → Add to Home Screen), then enable notifications.
              </p>
            )}
            {alerts.notificationError && (
              <p role="status">{alerts.notificationError}</p>
            )}
            {alerts.pushError && (
              <p role="status">{alerts.pushError}</p>
            )}
          </div>
          <label>
            <input
              type="checkbox"
              checked={quiet}
              onChange={(e) => setQuiet(e.target.checked)}
            />{" "}
            Keep the background plain
          </label>
          <a
            href="#pomodoro"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              document.getElementById("pomodoro")?.scrollIntoView({
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
              });
            }}
          >
            Change your timer below ↓
          </a>
        </div>
      )}
    </div>
  );
}
