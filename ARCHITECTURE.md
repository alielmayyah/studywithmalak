# Architecture

The static React app uses Supabase anonymous Auth. `unlock_identity` verifies a salted passcode hash and maps the browser to a stable Ali or Malak profile. RLS limits reads to the shared room. Passcodes are never stored in the frontend.

`pomodoro_command` validates membership and changes timer, focus session, break, and emoji status in one database transaction. `sync_room` settles expired phases from saved timestamps. Realtime changes trigger reloads; the client also synchronizes while visible and on reconnect. Focus intervals subtract pauses, clip to the local day, and calculate together overlap.

A private Realtime Presence channel reports online devices independently of persistent emoji status. Hidden and closing tabs untrack; visible tabs track again. A hard disconnect depends on the server detecting a lost socket.

The room fetches active and today's sessions; history fetches the 100 most recent completed sessions and shows five at a time. Both screens use a fixed viewport layout.
