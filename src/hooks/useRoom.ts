import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PomodoroState, PresenceState, Profile, Room, StudyBreak, StudySession, UserStatus } from '../lib/types'

export type RoomData = { room: Room; profiles: Profile[]; sessions: StudySession[]; breaks: StudyBreak[]; timers: PomodoroState[]; statuses: UserStatus[] }

export function useRoom(userId: string | null, history = false) {
  const [data, setData] = useState<RoomData | null>(null)
  const [online, setOnline] = useState<string[]>([])
  const [presenceReady, setPresenceReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(navigator.onLine)
  const reload = useCallback(async () => {
    if (!userId) return
    try {
      const membership = await supabase.from('room_members').select('room_id').eq('user_id', userId).limit(1)
      if (membership.error) throw membership.error
      const roomId = membership.data?.[0]?.room_id
      if (!roomId) throw new Error('Your account has not been added to the room.')
      if (!history) {
        const sync = await supabase.rpc('sync_room', { p_room: roomId })
        if (sync.error) throw sync.error
      }
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
      const [room, members, sessions, timers, statuses] = await Promise.all([
        supabase.from('rooms').select('*').eq('id', roomId).single(),
        supabase.from('room_members').select('user_id, profiles(id, display_name, created_at)').eq('room_id', roomId),
        history ? supabase.from('study_sessions').select('*').eq('room_id', roomId).not('ended_at', 'is', null).order('started_at', { ascending: false }).limit(100) : supabase.from('study_sessions').select('*').eq('room_id', roomId).or(`ended_at.is.null,ended_at.gte.${midnight.toISOString()}`).order('started_at', { ascending: false }),
        supabase.from('pomodoro_states').select('*').eq('room_id', roomId),
        supabase.from('user_statuses').select('*').eq('room_id', roomId),
      ])
      if (room.error || members.error || sessions.error || timers.error || statuses.error) throw room.error || members.error || sessions.error || timers.error || statuses.error
      const ids = (sessions.data || []).map(s => s.id)
      const breaks = ids.length ? await supabase.from('study_breaks').select('*').in('session_id', ids) : { data: [], error: null }
      if (breaks.error) throw breaks.error
      setData({ room: room.data as Room, profiles: (members.data || []).flatMap(m => m.profiles ? [m.profiles as unknown as Profile] : []), sessions: sessions.data as StudySession[], breaks: breaks.data as StudyBreak[], timers: timers.data as PomodoroState[], statuses: statuses.data as UserStatus[] })
      setError('')
    } catch (cause) {
      if (import.meta.env.DEV) console.error(JSON.stringify(cause))
      setError(cause instanceof Error && cause.message === 'Your account has not been added to the room.' ? cause.message : 'Could not load the room. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [userId, history])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!data?.room.id || !userId) return
    const roomId = data.room.id
    const channel = supabase.channel(`room:${roomId}`, { config: { private: true, presence: { key: userId } } })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceState>()
        setOnline([...new Set(Object.values(state).flatMap(items => items.map(item => item.user_id)))])
        setPresenceReady(true)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_sessions', filter: `room_id=eq.${roomId}` }, () => { void reload() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pomodoro_states', filter: `room_id=eq.${roomId}` }, () => { void reload() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_statuses', filter: `room_id=eq.${roomId}` }, () => { void reload() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_breaks' }, () => { void reload() })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setConnected(true)
          void channel.track({ user_id: userId, online_at: new Date().toISOString() })
          void reload()
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnected(false); setPresenceReady(false)
        }
      })
    const visibility = () => {
      if (document.visibilityState === 'visible') { void channel.track({ user_id: userId, online_at: new Date().toISOString() }); void reload() }
    }
    const leaving = () => { void channel.untrack() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', leaving)
    window.addEventListener('beforeunload', leaving)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', leaving)
      window.removeEventListener('beforeunload', leaving)
      void channel.untrack().finally(() => { void supabase.removeChannel(channel) })
    }
  }, [data?.room.id, userId, reload])
  useEffect(() => {
    const up = () => { setConnected(true); void reload() }
    const down = () => { setConnected(false); setPresenceReady(false) }
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [reload])
  useEffect(() => {
    if (history || !data?.room.id) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload() }, 5000)
    return () => window.clearInterval(timer)
  }, [history, data?.room.id, reload])
  return { data, online, presenceReady, loading, error, connected, reload }
}
