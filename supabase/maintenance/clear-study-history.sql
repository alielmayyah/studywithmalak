-- One-time production preparation. Run in the project's Supabase SQL Editor.
-- Clears ONLY Ali and Malak's shared-room study history and activity events.
-- Clears timer/status state and dated goals as well. Preserves only identity
-- and required room configuration: profiles, passcode hashes, authentication
-- accounts, access, rooms and memberships. Online Presence is ephemeral and
-- is not stored in these tables; connected tabs will still appear online.
-- This is intentionally NOT a migration and is never run on app startup.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Prevent in-flight timer commands from recreating history during the reset.
lock table public.pomodoro_states, public.study_sessions,
  public.study_breaks, public.user_statuses, public.room_events, public.daily_goals
  in exclusive mode;

do $$
declare
  target_room uuid;
  matching_rooms integer;
  session_count integer;
  break_count integer;
  event_count integer;
  timer_count integer;
  status_count integer;
  goal_count integer;
begin
  -- Refuse to guess if more than one room belongs exclusively to this pair.
  select count(*) into matching_rooms
  from (
    select m.room_id
    from public.room_members m
    join public.profiles p on p.id = m.user_id
    group by m.room_id
    having count(*) = 2
      and count(*) filter (where p.display_name = 'Ali') = 1
      and count(*) filter (where p.display_name = 'Malak') = 1
  ) candidates;
  if matching_rooms <> 1 then
    raise exception 'Expected exactly one Ali/Malak room; found %. Nothing cleared.', matching_rooms;
  end if;

  select m.room_id into target_room
  from public.room_members m
  join public.profiles p on p.id = m.user_id
  group by m.room_id
  having count(*) = 2
    and count(*) filter (where p.display_name = 'Ali') = 1
    and count(*) filter (where p.display_name = 'Malak') = 1;

  -- Remove timer foreign keys before deleting sessions.
  delete from public.pomodoro_states where room_id = target_room;
  get diagnostics timer_count = row_count;

  delete from public.user_statuses where room_id = target_room;
  get diagnostics status_count = row_count;

  delete from public.daily_goals where room_id = target_room;
  get diagnostics goal_count = row_count;

  delete from public.study_breaks b
  using public.study_sessions s
  where b.session_id = s.id and s.room_id = target_room;
  get diagnostics break_count = row_count;

  delete from public.study_sessions where room_id = target_room;
  get diagnostics session_count = row_count;

  delete from public.room_events where room_id = target_room;
  get diagnostics event_count = row_count;

  if exists (select 1 from public.study_sessions where room_id = target_room)
     or exists (select 1 from public.room_events where room_id = target_room)
     or exists (select 1 from public.pomodoro_states
                where room_id = target_room)
     or exists (select 1 from public.user_statuses where room_id = target_room)
     or exists (select 1 from public.daily_goals where room_id = target_room) then
    raise exception 'Reset verification failed. Transaction rolled back.';
  end if;

  raise notice 'Room %: cleared % sessions, % breaks, % activity events, % timers, % statuses and % dated goals. Users, passwords and required room configuration preserved.',
    target_room, session_count, break_count, event_count, timer_count, status_count, goal_count;
end;
$$;

commit;

-- Verify the preserved identities without exposing passwords or hashes.
select p.display_name,
       exists (select 1 from private.identity_secrets s where s.profile_id = p.id) as passcode_preserved
from public.profiles p
where p.display_name in ('Ali', 'Malak')
order by p.display_name;
