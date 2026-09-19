# Architecture

The static React app uses Supabase anonymous Auth. `unlock_identity` verifies a salted passcode hash and maps the browser to a stable Ali or Malak profile. RLS limits reads to the shared room. Passcodes are never stored in the frontend.

`pomodoro_command` validates membership and changes timer, focus session, break, and emoji status in one database transaction. `sync_room` settles expired phases from saved timestamps. Realtime changes trigger reloads; the client also synchronizes while visible and on reconnect. Focus intervals subtract pauses, clip to the local day, and calculate together overlap.

A private Realtime Presence channel reports connected devices independently of persistent emoji status. Connected background tabs remain online; closing tabs untrack. A hard disconnect depends on the server detecting a lost socket. Presence is aggregated across tabs by profile.

The room fetches active and today's sessions; history fetches the 100 most recent completed sessions and shows five at a time. Both screens scroll naturally. The room places Ali and Malak around the shared timer on desktop, and shows the partner before the local user on mobile. Shared-session time comes from the latest running focus timestamps; daily shared time remains the sum of interval intersections. Expired timers cannot appear as actively focusing while awaiting database settlement.

Global design tokens live in `src/styles.css`; room composition lives in `src/pages/room.css`. Each profile retains its own blue or pink identity, while the local identity controls timer actions. The optional plain-background preference is local to the device; timer and status persistence remain authoritative in Postgres.
