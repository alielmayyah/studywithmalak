import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { supabase, configured } from './lib/supabase'
import { RoomPage } from './pages/RoomPage'
import { HistoryPage } from './pages/HistoryPage'

function SignIn({ session, onUnlocked }: { session: Session | null; onUnlocked: (id: string) => void }) {
  const [identity, setIdentity] = useState(() => localStorage.getItem('study-identity') || '')
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (!session) {
        const { error: authError } = await supabase.auth.signInAnonymously()
        if (authError) throw authError
      }
      const { data, error: unlockError } = await supabase.rpc('unlock_identity', { p_name: identity, p_passcode: passcode })
      if (unlockError || !data) throw unlockError || new Error('Could not unlock identity')
      localStorage.setItem('study-identity', identity)
      setPasscode('')
      onUnlocked(data as string)
    } catch (cause) {
      if (import.meta.env.DEV) console.error(cause)
      setError('Could not enter the room. Check your passcode and try again.')
    } finally { setBusy(false) }
  }
  return <main className={`sign-in ${identity === 'Malak' ? 'theme-malak' : identity === 'Ali' ? 'theme-ali' : ''}`}><div className="brand">ALI <span>×</span> MALAK</div><section className="sign-in-panel"><div className="eyebrow">A PRIVATE STUDY ROOM</div><h1>Show up<br/><em>together.</em></h1><p>A quiet space to study side by side, wherever you are.</p>{!configured ? <div className="notice">Add your Supabase URL and public key to <code>.env.local</code> to connect this room.</div> : <><div className="identity-prompt">Who are you?</div><div className="identity-options">{['Ali', 'Malak'].map(name => <button key={name} type="button" className={`identity-button ${identity === name ? 'selected' : ''}`} onClick={() => { setIdentity(name); localStorage.setItem('study-identity', name); setError('') }}>{name}</button>)}</div>{identity && <form onSubmit={submit}><label htmlFor="passcode">Your private passcode</label><input id="passcode" type="password" required autoComplete="current-password" value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="Enter passcode"/><button className="primary" disabled={busy}>{busy ? 'Opening room…' : <>Enter room <ArrowRight size={17}/></>}</button></form>}{error && <p role="alert" className="error">{error}</p>}</>}<div className="sign-in-foot">A little progress, in good company.</div></section></main>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let mounted = true
    const load = async (next: Session | null) => {
      if (!mounted) return
      setSession(next)
      if (next) {
        const { data } = await supabase.from('profile_access').select('profile_id').eq('auth_user_id', next.user.id).maybeSingle()
        if (mounted) setProfileId(data?.profile_id || null)
      } else setProfileId(null)
      if (mounted) setReady(true)
    }
    void supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { void load(next) })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])
  if (!ready) return <div className="loading-screen">Opening your room…</div>
  if (!profileId) return <SignIn session={session} onUnlocked={setProfileId} />
  return <Routes><Route path="/" element={<RoomPage userId={profileId}/>} /><Route path="/history" element={<HistoryPage userId={profileId}/>} /><Route path="*" element={<Navigate to="/" replace/>}/></Routes>
}
