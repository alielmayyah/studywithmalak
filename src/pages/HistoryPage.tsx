import { useMemo } from 'react'
import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useClock } from '../hooks/useClock'
import { activeIntervals, formatShort, totalTime } from '../lib/time'

export function HistoryPage({ userId }: { userId: string }) {
  const { data, loading, error, reload } = useRoom(userId, true)
  const now = useClock()
  const sessions = useMemo(() => (data?.sessions || []).filter(s => s.ended_at), [data?.sessions])
  return <div className="app-shell history-shell"><header className="site-header"><Link className="brand" to="/">ALI <span>×</span> MALAK</Link><Link className="back-link" to="/"><ArrowLeft size={17}/> Back to room</Link></header><main className="history-main"><div className="eyebrow">THE DAYS ADD UP</div><h1>Study history<span>.</span></h1><p>A record of the time you made for learning.</p>{error && <div className="notice" role="alert">{error} <button onClick={() => void reload()}>Retry</button></div>}{loading ? <p>Loading sessions…</p> : sessions.length === 0 ? <div className="history-empty">Completed sessions will appear here after you finish studying.</div> : <div className="history-list">{sessions.map(session => { const person = data?.profiles.find(p => p.id === session.user_id); const duration = totalTime(activeIntervals(session, data?.breaks || [], now)); return <article className="history-item" key={session.id}><div className="history-date"><span>{format(new Date(session.started_at), 'dd')}</span>{format(new Date(session.started_at), 'MMM yyyy')}</div><div className="history-detail"><strong>{session.subject || 'Open study'}</strong><span>{person?.display_name || 'Member'} · {format(new Date(session.started_at), 'h:mm a')} – {format(new Date(session.ended_at!), 'h:mm a')}</span></div><div className="history-time">{formatShort(duration)}</div></article> })}</div>}</main></div>
}
