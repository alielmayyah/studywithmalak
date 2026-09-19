export type Profile = { id: string; display_name: string; created_at: string }
export type Room = { id: string; name: string; created_at: string }
export type StudySession = { id: string; room_id: string; user_id: string; subject: string | null; started_at: string; ended_at: string | null; created_at: string }
export type StudyBreak = { id: string; session_id: string; started_at: string; ended_at: string | null; created_at: string }
export type DailyGoal = { room_id: string; date: string; target_minutes: number }
export type RoomEvent = { id: string; room_id: string; user_id: string | null; type: string; message: string; created_at: string }
export type PresenceState = { user_id: string; online_at: string }
