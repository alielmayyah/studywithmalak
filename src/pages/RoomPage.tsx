import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ArrowRight, CircleHelp, Clock3, Focus, History, LogOut, Minimize2, Pause, RotateCcw, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useClock } from '../hooks/useClock'
import { activeIntervals, calculateOverlap, formatClock, formatShort, localDayRange, totalTime } from '../lib/time'
import { supabase } from '../lib/supabase'
import type { Profile, StudySession } from '../lib/types'

const actionErrors: Record<string, string> = { start: 'Could not start the study session.', break: 'Could not start your break.', resume: 'Could not resume studying.', finish: 'Could not finish the session.', goal: 'Could not update the daily goal.' }

export function RoomPage({ userId }: { userId: string }) {
  const { data, online, loading, error, connected, reload } = useRoom(userId)
  const now = useClock()
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [focus, setFocus] = useState(false)
  const [goalEditing, setGoalEditing] = useState(false)
  const [goalHours, setGoalHours] = useState('3')
  const day = useMemo(() => localDayRange(new Date(now)), [now])
  const profiles = data?.profiles || []
  const me = profiles.find(p => p.id === userId)
  const active = data?.sessions.find(s => s.user_id === userId && !s.ended_at)
  const onBreak = Boolean(active && data?.breaks.some(b => b.session_id === active.id && !b.ended_at))
  const times = profiles.map(p => ({ profile: p, ms: (data?.sessions || []).filter(s => s.user_id === p.id).reduce((sum, s) => sum + totalTime(activeIntervals(s, data?.breaks || [], now, day)), 0) }))
  const intervalSets = profiles.map(p => (data?.sessions || []).filter(s => s.user_id === p.id).flatMap(s => activeIntervals(s, data?.breaks || [], now, day)))
  const together = intervalSets.length >= 2 ? calculateOverlap(intervalSets[0], intervalSets[1]) : 0
  const target = (data?.goal?.target_minutes || 180) * 60000
  const completed = (data?.sessions || []).filter(s => s.ended_at && Date.parse(s.ended_at) >= day.start && Date.parse(s.ended_at) < day.end).length

  async function act(action: 'start' | 'break' | 'resume' | 'finish' | 'goal') {
    if (!data || busy || !connected) return
    setBusy(true); setActionError('')
    const { error: cause } = await supabase.rpc('room_action', { p_room: data.room.id, p_action: action, p_subject: action === 'start' ? subject.trim() || null : null, p_target_minutes: action === 'goal' ? Math.round(Number(goalHours) * 60) : null, p_date: format(new Date(), 'yyyy-MM-dd') })
    if (cause) { if (import.meta.env.DEV) console.error(cause); setActionError(`${actionErrors[action]} Please try again.`) }
    else { if (action === 'start') setSubject(''); if (action === 'goal') setGoalEditing(false); await reload() }
    setBusy(false)
  }

  if (loading && !data) return <div className="loading-screen">Opening your room…</div>
  if (!data) return <main className="empty-screen"><div className="brand">ALI <span>×</span> MALAK</div><h1>We couldn’t open the room.</h1><p>{error}</p><button className="primary" onClick={() => void reload()}>Try again</button><button className="text-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></main>
  if (!me) return <main className="empty-screen"><h1>Account not set up</h1><p>Your account needs a profile in this room.</p><button className="text-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></main>
  return <div className={`app-shell ${focus ? 'is-focus' : ''}`}><header className="site-header"><Link className="brand" to="/">ALI <span>×</span> MALAK</Link><div className="header-center">{format(new Date(now), 'EEEE, MMMM d')} <span className="header-dot">·</span> Our study room</div><nav aria-label="Main navigation"><button className="icon-button" onClick={() => setFocus(!focus)} aria-label={focus ? 'Exit focus mode' : 'Enter focus mode'} title={focus ? 'Exit focus' : 'Focus mode'}>{focus ? <Minimize2 size={19}/> : <Focus size={19}/>}</button><Link className="icon-button hide-focus" to="/history" aria-label="Study history" title="History"><History size={19}/></Link><button className="icon-button hide-focus" onClick={() => void supabase.auth.signOut()} aria-label="Sign out" title="Sign out"><LogOut size={19}/></button></nav></header>
    {!connected && <div className="connection" role="status"><WifiOff size={16}/> Connection lost. Showing your last saved state; actions will return when connected.</div>}
    {error && <div className="connection" role="alert">{error} <button onClick={() => void reload()}>Retry</button></div>}
    <main className="room-main"><section className="hero" aria-label="Together time"><div className="eyebrow">TODAY, TOGETHER</div><div className="hero-time" aria-live="off">{formatClock(together)}</div><div className="hero-rule"><span/></div><p>{intervalSets.length >= 2 && profiles.every(p => data.sessions.some(s => s.user_id === p.id && !s.ended_at && !data.breaks.some(b => b.session_id === s.id && !b.ended_at))) ? 'You are studying together right now.' : 'Every minute together counts.'}</p></section>
      <section className="people-grid" aria-label="People in the room">{profiles.map((profile, index) => <PersonCard key={profile.id} profile={profile} session={data.sessions.find(s => s.user_id === profile.id && !s.ended_at)} onBreak={data.sessions.some(s => s.user_id === profile.id && !s.ended_at && data.breaks.some(b => b.session_id === s.id && !b.ended_at))} online={online.includes(profile.id)} isMe={profile.id === userId} time={times[index]?.ms || 0} />)}</section>
      <section className="lower-grid hide-focus"><div className="action-panel"><div className="panel-heading"><span>YOUR DESK</span><span>{me.display_name}</span></div>{!active ? <><h2>What are you working on?</h2><div className="start-form"><label className="sr-only" htmlFor="subject">Subject or task</label><input id="subject" maxLength={120} value={subject} onChange={e => setSubject(e.target.value)} placeholder="A subject or task (optional)" onKeyDown={e => { if (e.key === 'Enter') void act('start') }}/><button className="primary" disabled={busy || !connected} onClick={() => void act('start')}>Start studying <ArrowRight size={18}/></button></div></> : <><h2>{onBreak ? 'Take your time.' : 'Stay with it.'}</h2><p className="panel-copy">{onBreak ? 'Your timer is paused. Return when you’re ready.' : `Studying ${active.subject || 'at your own pace'}.`}</p><div className="action-row"><button className="primary" disabled={busy || !connected} onClick={() => void act(onBreak ? 'resume' : 'break')}>{onBreak ? <RotateCcw size={17}/> : <Pause size={17}/>} {onBreak ? 'Resume studying' : 'Take a break'}</button><button className="secondary" disabled={busy || !connected} onClick={() => void act('finish')}>Finish session</button></div></>}{actionError && <p className="error" role="alert">{actionError}</p>}</div>
      <div className="summary-panel"><div className="panel-heading"><span>TODAY AT A GLANCE</span><Clock3 size={16}/></div><div className="summary-rows">{times.map(t => <div className="summary-row" key={t.profile.id}><span>{t.profile.display_name}</span><strong>{formatShort(t.ms)}</strong></div>)}<div className="summary-row together-row"><span>Together</span><strong>{formatShort(together)}</strong></div></div><div className="goal-line"><div className="goal-label"><span>Daily goal</span><button onClick={() => { setGoalHours(String((data.goal?.target_minutes || 180) / 60)); setGoalEditing(true) }} aria-label="Change daily goal">{formatShort(together)} / {formatShort(target)} <CircleHelp size={14}/></button></div><div className="progress" role="progressbar" aria-valuenow={Math.min(100, Math.round(together / target * 100))} aria-valuemin={0} aria-valuemax={100} aria-label="Together daily goal progress"><span style={{ width: `${Math.min(100, together / target * 100)}%` }}/></div></div><p className="sessions-note">{completed} {completed === 1 ? 'session' : 'sessions'} completed today</p>{goalEditing && <div className="goal-edit"><label htmlFor="goal-hours">Goal in hours</label><input id="goal-hours" type="number" min="0.5" max="24" step="0.5" value={goalHours} onChange={e => setGoalHours(e.target.value)}/><button disabled={busy || !connected || !Number(goalHours) || Number(goalHours) > 24} onClick={() => void act('goal')}>Save</button><button onClick={() => setGoalEditing(false)}>Cancel</button></div>}</div></section>
      <section className="activity hide-focus"><div className="panel-heading"><span>RECENT MOMENTS</span><span>LIVE ACTIVITY</span></div>{data.events.length ? <ul>{data.events.slice(0, 4).map(event => <li key={event.id}><span className="activity-dot"/>{event.message}<time dateTime={event.created_at}>{format(new Date(event.created_at), 'h:mm a')}</time></li>)}</ul> : <p>When you begin, your shared moments will appear here.</p>}</section>
    </main><footer className="footer hide-focus"><span>Made for showing up together.</span><span>One day at a time.</span></footer></div>
}

function PersonCard({ profile, session, onBreak, online, isMe, time }: { profile: Profile; session?: StudySession; onBreak: boolean; online: boolean; isMe: boolean; time: number }) {
  const state = !online ? 'Offline' : onBreak ? 'On break' : session ? 'Studying' : 'Online'
  return <article className={`person-card ${session && !onBreak ? 'studying' : ''}`}><div className="person-top"><div className="avatar">{profile.display_name.slice(0, 1)}</div><div className="person-name"><h2>{profile.display_name}{isMe && <span>YOU</span>}</h2><div className={`status ${online ? 'is-online' : ''}`}><i/>{state}</div></div><span className="person-index">0{isMe ? '1' : '2'}</span></div><div className="person-bottom"><div><div className="small-label">CURRENT FOCUS</div><div className="subject-text">{session ? (session.subject || 'Open study') : 'No active session'}</div></div><div className="person-duration"><div className="small-label">STUDIED TODAY</div><strong>{formatClock(time)}</strong></div></div></article>
}
