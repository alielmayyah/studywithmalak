import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useClock } from '../hooks/useClock'
import { activeIntervals, formatMinutes, totalTime } from '../lib/time'
import './room.css'

export function HistoryPage({ userId }: { userId: string }) {
  const { data, loading, error, reload } = useRoom(userId, true)
  const now = useClock()
  const [page, setPage] = useState(0)
  const sessions = useMemo(() => (data?.sessions || []).filter(s => s.ended_at), [data?.sessions])
  const pageSize = 5
  const pageCount = Math.max(1, Math.ceil(sessions.length / pageSize))
  const shown = sessions.slice(page * pageSize, (page + 1) * pageSize)
  return <div className={`app-shell history-shell ${data?.profiles.find(p => p.id === userId)?.display_name === 'Malak' ? 'theme-malak' : 'theme-ali'}`}>
    <header className="site-header"><Link className="brand" to="/">ALI <span>×</span> MALAK</Link><Link className="back-link" to="/"><ArrowLeft size={17}/> Back to room</Link></header>
    <main className="history-main"><div className="eyebrow">THE DAYS ADD UP</div><h1>Study history<span>.</span></h1><p>Time you made for learning.</p>
      {error && <div className="notice" role="alert">{error} <button onClick={() => void reload()}>Retry</button></div>}
      {loading ? <p>Loading sessions…</p> : sessions.length === 0 ? <div className="history-empty">Completed focus sessions will appear here.</div> : <>
        <div className="history-list">{shown.map(session => {
          const person = data?.profiles.find(p => p.id === session.user_id)
          const duration = totalTime(activeIntervals(session, data?.breaks || [], now))
          return <article className="history-item" key={session.id}><div className="history-date"><span>{format(new Date(session.started_at), 'dd')}</span>{format(new Date(session.started_at), 'MMM yyyy')}</div><div className="history-detail"><strong>{person?.display_name || 'Member'} focused</strong><span>{format(new Date(session.started_at), 'h:mm a')} – {format(new Date(session.ended_at!), 'h:mm a')}</span></div><div className="history-time">{formatMinutes(duration)}</div></article>
        })}</div>
        <div className="history-pages"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Next</button></div>
      </>}
    </main>
  </div>
}
