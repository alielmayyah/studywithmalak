-- Preserve any focus time recorded by the previous client before switching models.
update public.study_breaks b set ended_at = now()
from public.study_sessions s where b.session_id = s.id and s.ended_at is null and b.ended_at is null;
update public.study_sessions set ended_at = now() where ended_at is null;

create table public.pomodoro_states (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  phase text not null default 'idle' check (phase in ('idle', 'focus', 'break')),
  run_state text not null default 'idle' check (run_state in ('idle', 'running', 'paused')),
  phase_started_at timestamptz,
  remaining_ms bigint not null default 1500000 check (remaining_ms >= 0),
  focus_minutes integer not null default 25 check (focus_minutes between 1 and 180),
  break_minutes integer not null default 5 check (break_minutes between 1 and 60),
  focus_session_id uuid references public.study_sessions(id),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id),
  check ((phase = 'idle' and run_state = 'idle' and focus_session_id is null) or
         (phase = 'focus' and run_state in ('running', 'paused') and focus_session_id is not null) or
         (phase = 'break' and run_state = 'running' and focus_session_id is null))
);

create table public.user_statuses (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'away' check (status in ('focus', 'break', 'eating', 'away', 'done')),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

insert into public.user_statuses(room_id, user_id)
select room_id, user_id from public.room_members on conflict do nothing;

alter table public.pomodoro_states enable row level security;
alter table public.user_statuses enable row level security;
create policy pomodoro_read on public.pomodoro_states for select to authenticated using (public.is_room_member(room_id));
create policy statuses_read on public.user_statuses for select to authenticated using (public.is_room_member(room_id));
alter publication supabase_realtime add table public.pomodoro_states, public.user_statuses;

create function private.settle_pomodoro(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare state_row public.pomodoro_states%rowtype; deadline timestamptz;
begin
  select * into state_row from public.pomodoro_states
    where room_id = p_room and user_id = p_user for update;
  if state_row.phase = 'focus' and state_row.run_state = 'running' then
    deadline := state_row.phase_started_at + state_row.remaining_ms * interval '1 millisecond';
    if clock_timestamp() >= deadline then
      update public.study_sessions set ended_at = deadline
        where id = state_row.focus_session_id and ended_at is null;
      update public.pomodoro_states set phase = 'break', run_state = 'running',
        phase_started_at = deadline, remaining_ms = state_row.break_minutes * 60000,
        focus_session_id = null, updated_at = clock_timestamp()
        where room_id = p_room and user_id = p_user;
      insert into public.user_statuses(room_id, user_id, status) values(p_room, p_user, 'break')
        on conflict(room_id, user_id) do update set status = 'break', updated_at = clock_timestamp();
      state_row.phase := 'break';
      state_row.phase_started_at := deadline;
      state_row.remaining_ms := state_row.break_minutes * 60000;
    end if;
  end if;
  if state_row.phase = 'break' and state_row.run_state = 'running' then
    deadline := state_row.phase_started_at + state_row.remaining_ms * interval '1 millisecond';
    if clock_timestamp() >= deadline then
      update public.pomodoro_states set phase = 'idle', run_state = 'idle',
        phase_started_at = null, remaining_ms = state_row.focus_minutes * 60000,
        updated_at = clock_timestamp()
        where room_id = p_room and user_id = p_user;
      update public.user_statuses set status = 'away', updated_at = clock_timestamp()
        where room_id = p_room and user_id = p_user and status = 'break';
    end if;
  end if;
end;
$$;
revoke all on function private.settle_pomodoro(uuid, uuid) from public, anon, authenticated;

create function public.sync_room(p_room uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare member record;
begin
  if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'Not a room member'; end if;
  for member in select user_id from public.room_members where room_id = p_room order by user_id loop
    perform private.settle_pomodoro(p_room, member.user_id);
  end loop;
end;
$$;
revoke all on function public.sync_room(uuid) from public, anon;
grant execute on function public.sync_room(uuid) to authenticated;

create function public.pomodoro_command(
  p_room uuid, p_action text, p_focus_minutes integer default null,
  p_break_minutes integer default null, p_status text default null
)
returns void language plpgsql security definer set search_path = public, private as $$
declare actor uuid; state_row public.pomodoro_states%rowtype; new_session_id uuid;
        action_at timestamptz; remaining bigint;
begin
  if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'Not a room member'; end if;
  actor := public.current_profile_id();
  perform private.settle_pomodoro(p_room, actor);
  insert into public.pomodoro_states(room_id, user_id) values(p_room, actor) on conflict do nothing;
  select * into state_row from public.pomodoro_states where room_id = p_room and user_id = actor for update;
  action_at := clock_timestamp();

  if p_action = 'start' then
    if state_row.phase <> 'idle' then raise exception 'Timer already active'; end if;
    if p_focus_minutes is null or p_break_minutes is null or p_focus_minutes not between 1 and 180 or p_break_minutes not between 1 and 60 then raise exception 'Invalid duration'; end if;
    insert into public.study_sessions(room_id, user_id, started_at) values(p_room, actor, action_at) returning id into new_session_id;
    update public.pomodoro_states set phase = 'focus', run_state = 'running',
      phase_started_at = action_at, remaining_ms = p_focus_minutes * 60000,
      focus_minutes = p_focus_minutes, break_minutes = p_break_minutes,
      focus_session_id = new_session_id, updated_at = action_at
      where room_id = p_room and user_id = actor;
    p_status := 'focus';

  elsif p_action = 'pause' or (p_action = 'status' and p_status <> 'focus' and state_row.phase = 'focus' and state_row.run_state = 'running') then
    if state_row.phase <> 'focus' or state_row.run_state <> 'running' then raise exception 'Timer is not running'; end if;
    remaining := greatest(0, state_row.remaining_ms - floor(extract(epoch from action_at - state_row.phase_started_at) * 1000)::bigint);
    insert into public.study_breaks(session_id, started_at) values(state_row.focus_session_id, action_at);
    update public.pomodoro_states set run_state = 'paused', phase_started_at = null,
      remaining_ms = remaining, updated_at = action_at where room_id = p_room and user_id = actor;
    if p_action = 'pause' then p_status := 'break'; end if;

  elsif p_action = 'resume' or (p_action = 'status' and p_status = 'focus' and state_row.phase = 'focus' and state_row.run_state = 'paused') then
    if state_row.phase <> 'focus' or state_row.run_state <> 'paused' then raise exception 'Timer is not paused'; end if;
    update public.study_breaks set ended_at = action_at where session_id = state_row.focus_session_id and ended_at is null;
    update public.pomodoro_states set run_state = 'running', phase_started_at = action_at,
      updated_at = action_at where room_id = p_room and user_id = actor;
    p_status := 'focus';

  elsif p_action = 'break' then
    if state_row.phase <> 'focus' then raise exception 'No focus timer'; end if;
    update public.study_breaks set ended_at = action_at where session_id = state_row.focus_session_id and ended_at is null;
    update public.study_sessions set ended_at = action_at where id = state_row.focus_session_id and ended_at is null;
    update public.pomodoro_states set phase = 'break', run_state = 'running',
      phase_started_at = action_at, remaining_ms = state_row.break_minutes * 60000,
      focus_session_id = null, updated_at = action_at where room_id = p_room and user_id = actor;
    p_status := 'break';

  elsif p_action = 'skip_break' or p_action = 'end' then
    if state_row.phase = 'idle' then raise exception 'No active timer'; end if;
    if state_row.phase = 'focus' then
      update public.study_breaks set ended_at = action_at where session_id = state_row.focus_session_id and ended_at is null;
      update public.study_sessions set ended_at = action_at where id = state_row.focus_session_id and ended_at is null;
    end if;
    update public.pomodoro_states set phase = 'idle', run_state = 'idle',
      phase_started_at = null, remaining_ms = state_row.focus_minutes * 60000,
      focus_session_id = null, updated_at = action_at where room_id = p_room and user_id = actor;
    p_status := 'away';

  elsif p_action <> 'status' then
    raise exception 'Unknown action';
  end if;

  if p_status is not null then
    if p_status not in ('focus', 'break', 'eating', 'away', 'done') then raise exception 'Invalid status'; end if;
    insert into public.user_statuses(room_id, user_id, status, updated_at) values(p_room, actor, p_status, action_at)
      on conflict(room_id, user_id) do update set status = excluded.status, updated_at = excluded.updated_at;
  end if;
end;
$$;
revoke all on function public.pomodoro_command(uuid, text, integer, integer, text) from public, anon;
grant execute on function public.pomodoro_command(uuid, text, integer, integer, text) to authenticated;

revoke execute on function public.room_action(uuid, text, text, integer, date) from authenticated;
