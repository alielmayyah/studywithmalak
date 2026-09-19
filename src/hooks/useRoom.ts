import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DailyGoal, PresenceState, Profile, Room, RoomEvent, StudyBreak, StudySession } from '../lib/types'
import { format } from 'date-fns'

export type RoomData = { room: Room; profiles: Profile[]; sessions: StudySession[]; breaks: StudyBreak[]; goal: DailyGoal | null; events: RoomEvent[] }

export function useRoom(userId: string | null, history = false) {
  const [data, setData] = useState<RoomData | null>(null)
  const [online, setOnline] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(navigator.onLine)
  const reload = useCallback(async () => {
    if (!userId) return
    try {
      const { data: memberships, error: memberError } = await supabase.from('room_members').select('room_id').eq('user_id', userId).limit(1)
      if (memberError) throw memberError
      const roomId = memberships?.[0]?.room_id
      if (!roomId) throw new Error('Your account has not been added to the room.')
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
      const day = format(midnight, 'yyyy-MM-dd')
      const [room, members, sessions, goal, events] = await Promise.all([
        supabase.from('rooms').select('*').eq('id', roomId).single(),
        supabase.from('room_members').select('user_id, profiles(id, display_name, created_at)').eq('room_id', roomId),
        history ? supabase.from('study_sessions').select('*').eq('room_id', roomId).not('ended_at', 'is', null).order('started_at', { ascending: false }).limit(100) : supabase.from('study_sessions').select('*').eq('room_id', roomId).or(`ended_at.is.null,ended_at.gte.${midnight.toISOString()}`).order('started_at', { ascending: false }),
        supabase.from('daily_goals').select('*').eq('room_id', roomId).eq('date', day).maybeSingle(),
        supabase.from('room_events').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(8),
      ])
      if (room.error || members.error || sessions.error || goal.error || events.error) throw room.error || members.error || sessions.error || goal.error || events.error
      const ids = (sessions.data || []).map(s => s.id)
      const breaks = ids.length ? await supabase.from('study_breaks').select('*').in('session_id', ids) : { data: [], error: null }
      if (breaks.error) throw breaks.error
      setData({ room: room.data as Room, profiles: (members.data || []).flatMap(m => m.profiles ? [m.profiles as unknown as Profile] : []), sessions: sessions.data as StudySession[], breaks: breaks.data as StudyBreak[], goal: goal.data as DailyGoal | null, events: events.data as RoomEvent[] })
      setError('')
    } catch (cause) {
      if (import.meta.env.DEV) console.error(cause)
      setError(cause instanceof Error && cause.message === 'Your account has not been added to the room.' ? cause.message : 'Could not load the room. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [userId, history])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!data?.room.id || !userId) return
    const syncPresence = () => {
      const state = channel.presenceState<PresenceState>()
      setOnline([...new Set(Object.values(state).flatMap(items => items.map(item => item.user_id)))])
    }
    const channel = supabase.channel(`room:${data.room.id}`, { config: { private: true, presence: { key: userId } } })
      .on('presence', { event: 'sync' }, syncPresence)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_sessions', filter: `room_id=eq.${data.room.id}` }, () => { void reload() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_events', filter: `room_id=eq.${data.room.id}` }, () => { void reload() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_goals', filter: `room_id=eq.${data.room.id}` }, () => { void reload() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_breaks' }, () => { void reload() })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { setConnected(true); void channel.track({ user_id: userId, online_at: new Date().toISOString() }); void reload() }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnected(false)
      })
    return () => { void supabase.removeChannel(channel) }
  }, [data?.room.id, userId, reload])
  useEffect(() => {
    const up = () => { setConnected(true); void reload() }
    const down = () => setConnected(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [reload])
  useEffect(() => {
    if (history) return
    let timeout: number
    const schedule = () => {
      const next = new Date(); next.setHours(24, 0, 1, 0)
      timeout = window.setTimeout(() => { void reload(); schedule() }, next.getTime() - Date.now())
    }
    schedule()
    return () => window.clearTimeout(timeout)
  }, [history, reload])
  return { data, online, loading, error, connected, reload }
}
