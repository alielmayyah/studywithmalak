# Architecture

The static React app reads room data through the Supabase client. Supabase anonymous Auth identifies each browser. The `unlock_identity` function verifies a salted passcode hash and maps that browser to a stable Ali or Malak profile. RLS limits reads to rooms belonging to that profile. Mutations go through `room_action`, a security-definer SQL function that validates membership and performs each state change transactionally. Partial unique indexes prohibit multiple active sessions per member and multiple open breaks per session.

Supabase Realtime Postgres changes trigger room reloads. A private Presence channel tracks connected clients separately from study state. Timers use database timestamps and the current clock only for display. The reusable interval functions in `src/lib/time.ts` subtract breaks, clip to date ranges, and calculate overlap.

The room fetches sessions that are active or ended since local midnight. History fetches the 100 most recent completed sessions. Daily goals and recent events are room scoped. The frontend never stores passcodes; Supabase Auth manages its own anonymous session and the local identity preference contains only a display name.
