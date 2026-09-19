export type Profile = { id: string; display_name: string; created_at: string }
export type Room = { id: string; name: string; created_at: string }
export type StudySession = { id: string; room_id: string; user_id: string; subject: string | null; started_at: string; ended_at: string | null; created_at: string }
export type StudyBreak = { id: string; session_id: string; started_at: string; ended_at: string | null; created_at: string }
export type PresenceState = { user_id: string; online_at: string }
export type UserStatus = { room_id: string; user_id: string; status: 'focus' | 'break' | 'eating' | 'away' | 'done'; updated_at: string }
export type PomodoroState = { room_id: string; user_id: string; phase: 'idle' | 'focus' | 'break'; run_state: 'idle' | 'running' | 'paused'; phase_started_at: string | null; remaining_ms: number; focus_minutes: number; break_minutes: number; focus_session_id: string | null; updated_at: string }
