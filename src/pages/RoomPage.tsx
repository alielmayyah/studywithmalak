import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { History, LogOut, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useClock } from '../hooks/useClock'
import { activeIntervals, calculateOverlap, formatCountdown, formatMinutes, localDayRange, totalTime } from '../lib/time'
import { supabase } from '../lib/supabase'
import type { PomodoroState, Profile, UserStatus } from '../lib/types'
import './room.css'

const statuses = [
  { value: 'focus', label: 'Focusing', emoji: '✦' },
  { value: 'break', label: 'On a break', emoji: '☕' },
  { value: 'eating', label: 'Eating', emoji: '🍽️' },
  { value: 'away', label: 'Away', emoji: '🌙' },
  { value: 'done', label: 'Done for today', emoji: '✓' },
] as const

function remaining(timer: PomodoroState | undefined, now: number) {
  if (!timer) return 25 * 60000
  return timer.run_state === 'running' && timer.phase_started_at
    ? Math.max(0, timer.remaining_ms - (now - Date.parse(timer.phase_started_at)))
    : timer.remaining_ms
}

export function RoomPage({ userId }: { userId: string }) {
  const { data, online, presenceReady, loading, error, connected, reload } = useRoom(userId)
  const now = useClock()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [preset, setPreset] = useState('25/5')
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [breakMinutes, setBreakMinutes] = useState(5)
  const day = useMemo(() => localDayRange(new Date(now)), [now])
  const profiles = [...(data?.profiles || [])].sort((a, b) => a.display_name.localeCompare(b.display_name))
  const me = profiles.find(p => p.id === userId)
  const ownTimer = data?.timers.find(t => t.user_id === userId)
  const ownStatus = data?.statuses.find(s => s.user_id === userId)?.status || 'away'
  const intervals = profiles.map(profile => (data?.sessions || []).filter(s => s.user_id === profile.id).flatMap(s => {
    const timer = data?.timers.find(t => t.focus_session_id === s.id)
    const cap = timer?.run_state === 'running' && timer.phase_started_at ? Date.parse(timer.phase_started_at) + timer.remaining_ms : undefined
    return activeIntervals(s, data?.breaks || [], now, day, cap)
  }))
  const totals = intervals.map(totalTime)
  const together = intervals.length >= 2 ? calculateOverlap(intervals[0], intervals[1]) : 0
  const bothFocusing = profiles.length === 2 && profiles.every(p => data?.timers.some(t => t.user_id === p.id && t.phase === 'focus' && t.run_state === 'running'))

  async function command(action: string, status?: UserStatus['status']) {
    if (!data || busy || !connected) return
    setBusy(true); setActionError('')
    const { error: cause } = await supabase.rpc('pomodoro_command', {
      p_room: data.room.id, p_action: action,
      p_focus_minutes: action === 'start' ? focusMinutes : null,
      p_break_minutes: action === 'start' ? breakMinutes : null,
      p_status: status || null,
    })
    if (cause) { if (import.meta.env.DEV) console.error(JSON.stringify(cause)); setActionError('Could not save that change. Please try again.') }
    else await reload()
    setBusy(false)
  }
  function selectPreset(value: string) {
    setPreset(value)
    if (value === '25/5') { setFocusMinutes(25); setBreakMinutes(5) }
    if (value === '50/10') { setFocusMinutes(50); setBreakMinutes(10) }
  }

  if (loading && !data) return <div className="loading-screen">Opening your room…</div>
  if (!data) return <main className="empty-screen"><h1>We couldn’t open the room.</h1><p>{error}</p><button className="primary" onClick={() => void reload()}>Try again</button><button className="text-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></main>
  if (!me) return <main className="empty-screen"><h1>Account not set up</h1><p>Your account needs a profile in this room.</p><button onClick={() => void supabase.auth.signOut()}>Sign out</button></main>

  return <div className={`app-shell room-shell ${me.display_name === 'Malak' ? 'theme-malak' : 'theme-ali'}`}>
    <header className="site-header">
      <Link className="brand" to="/">ALI <span>×</span> MALAK</Link>
      <div className="header-center">{format(new Date(now), 'EEEE, MMMM d')}</div>
      <nav aria-label="Main navigation"><Link className="icon-button" to="/history" aria-label="Study history" title="History"><History size={18}/></Link><button className="icon-button" onClick={() => void supabase.auth.signOut()} aria-label="Sign out" title="Sign out"><LogOut size={18}/></button></nav>
    </header>
    {!connected && <div className="connection" role="status"><WifiOff size={16}/> Connection lost. Reconnecting…</div>}
    {error && <div className="connection" role="alert">{error} <button onClick={() => void reload()}>Retry</button></div>}
    <main className="room-main">
      <section className="together" aria-label="Together today">
        <div className="eyebrow">OUR STUDY ROOM</div>
        <h1>We showed up together.</h1>
        <p>{bothFocusing ? 'You are focusing together right now.' : 'A quiet place to make time for each other.'}</p>
        <div className="together-total"><strong>{formatMinutes(together)}</strong><span>together today</span></div>
      </section>
      <section className="people-grid" aria-label="People in the room">
        {profiles.map((profile, index) => <Person key={profile.id} profile={profile} online={presenceReady ? online.includes(profile.id) : null} status={data.statuses.find(s => s.user_id === profile.id)?.status || 'away'} timer={data.timers.find(t => t.user_id === profile.id)} isMe={profile.id === userId} total={totals[index] || 0} onStatus={status => void command('status', status)} busy={busy || !connected} now={now}/>)}
      </section>
      <section className="timer-area" aria-label="Your focus timer">
        <div className="timer-info"><div className="eyebrow">YOUR TIMER</div><h2>{ownTimer?.phase === 'break' ? 'Take a breath.' : ownTimer?.phase === 'focus' ? 'Stay with it.' : 'Ready when you are.'}</h2><p>{ownTimer?.phase === 'break' ? 'Your break ends automatically.' : ownTimer?.run_state === 'paused' ? 'Paused. Pick up where you left off.' : ownTimer?.phase === 'focus' ? 'One moment at a time.' : 'Choose a rhythm and begin.'}</p></div>
        <div className="timer-clock"><span>{ownTimer?.phase === 'break' ? 'BREAK' : 'FOCUS'}</span><strong>{formatCountdown(ownTimer?.phase === 'idle' || !ownTimer ? focusMinutes * 60000 : remaining(ownTimer, now))}</strong></div>
        <div className="timer-controls">
          {(!ownTimer || ownTimer.phase === 'idle') && <>
            <div className="presets" aria-label="Timer length">{['25/5', '50/10', 'Custom'].map(value => <button key={value} className={preset === value ? 'selected' : ''} onClick={() => selectPreset(value)}>{value === 'Custom' ? value : value.replace('/', ' / ')}</button>)}</div>
            {preset === 'Custom' && <div className="custom-times"><label>Focus <input type="number" min="1" max="180" value={focusMinutes} onChange={e => setFocusMinutes(Number(e.target.value))}/> min</label><label>Break <input type="number" min="1" max="60" value={breakMinutes} onChange={e => setBreakMinutes(Number(e.target.value))}/> min</label></div>}
            <button className="primary" disabled={busy || !connected || focusMinutes < 1 || focusMinutes > 180 || breakMinutes < 1 || breakMinutes > 60} onClick={() => void command('start')}>Start focus</button>
          </>}
          {ownTimer?.phase === 'focus' && <><button className="primary" disabled={busy || !connected} onClick={() => void command(ownTimer.run_state === 'paused' ? 'resume' : 'pause')}>{ownTimer.run_state === 'paused' ? 'Resume' : 'Pause'}</button><button className="secondary" disabled={busy || !connected} onClick={() => void command('break')}>Start break</button><button className="text-button" disabled={busy || !connected} onClick={() => void command('end')}>End</button></>}
          {ownTimer?.phase === 'break' && <><button className="primary" disabled={busy || !connected} onClick={() => void command('skip_break')}>Finish break</button><button className="text-button" disabled={busy || !connected} onClick={() => void command('end')}>End</button></>}
        </div>
      </section>
      <div className="today-line" aria-label="Focus time today"><span>TODAY</span>{profiles.map((profile, index) => <span key={profile.id}>{profile.display_name} <strong>{formatMinutes(totals[index] || 0)}</strong></span>)}<span>Together <strong>{formatMinutes(together)}</strong></span></div>
      {actionError && <p className="error room-error" role="alert">{actionError}</p>}
      {ownStatus === 'done' && <div className="sr-only">Done for today</div>}
    </main>
  </div>
}

function Person({ profile, online, status, timer, isMe, total, onStatus, busy, now }: { profile: Profile; online: boolean | null; status: UserStatus['status']; timer?: PomodoroState; isMe: boolean; total: number; onStatus: (status: UserStatus['status']) => void; busy: boolean; now: number }) {
  const [open, setOpen] = useState(false)
  const current = statuses.find(s => s.value === status) || statuses[3]
  const avatar = profile.display_name === 'Ali' ? 'ali.webp' : 'malak.webp'
  return <article className={`person-card ${isMe ? 'is-me' : ''}`}>
    <div className="person-top"><div className="avatar"><img src={`${import.meta.env.BASE_URL}avatars/${avatar}`} alt=""/></div><div className="person-name"><h2>{profile.display_name}{isMe && <span>YOU</span>}</h2><div className={`status ${online ? 'is-online' : ''}`}><i/>{online === null ? 'Connecting…' : online ? 'Online' : 'Offline'}</div></div></div>
    <div className="person-bottom"><div className="status-wrap">{isMe ? <><button className="person-status" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Change your status">{current.emoji} {current.label} <span>⌄</span></button>{open && <div className="status-menu">{statuses.map(item => <button key={item.value} disabled={busy} onClick={() => { onStatus(item.value); setOpen(false) }}>{item.emoji} {item.label}</button>)}</div>}</> : <div className="person-status">{current.emoji} {current.label}</div>}</div><div className="person-duration"><small>FOCUS TODAY</small><strong>{formatMinutes(total)}</strong></div></div>
    {timer?.phase !== 'idle' && timer && <div className="person-timer">{timer.phase === 'break' ? 'On a break' : timer.run_state === 'paused' ? 'Focus paused' : 'Focusing'} · {formatCountdown(remaining(timer, now))}</div>}
  </article>
}
