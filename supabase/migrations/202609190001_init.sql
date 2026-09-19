create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (id uuid primary key default gen_random_uuid(), display_name text not null unique, created_at timestamptz not null default now());
create table public.profile_access (auth_user_id uuid primary key references auth.users(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now());
create table private.identity_secrets (profile_id uuid primary key references public.profiles(id) on delete cascade, passcode_hash text not null);
create table public.rooms (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.room_members (room_id uuid not null references public.rooms(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, joined_at timestamptz not null default now(), primary key (room_id, user_id));
create table public.study_sessions (id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id), user_id uuid not null references public.profiles(id), subject text, started_at timestamptz not null default now(), ended_at timestamptz, created_at timestamptz not null default now(), constraint valid_session_time check (ended_at is null or ended_at >= started_at));
create unique index one_active_session on public.study_sessions(room_id, user_id) where ended_at is null;
create index sessions_room_time on public.study_sessions(room_id, started_at desc);
create table public.study_breaks (id uuid primary key default gen_random_uuid(), session_id uuid not null references public.study_sessions(id) on delete cascade, started_at timestamptz not null default now(), ended_at timestamptz, created_at timestamptz not null default now(), constraint valid_break_time check (ended_at is null or ended_at >= started_at));
create unique index one_active_break on public.study_breaks(session_id) where ended_at is null;
create index breaks_session on public.study_breaks(session_id);
create table public.daily_goals (room_id uuid not null references public.rooms(id) on delete cascade, date date not null, target_minutes integer not null check (target_minutes between 1 and 1440), created_at timestamptz not null default now(), primary key(room_id, date));
create table public.room_events (id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade, user_id uuid references public.profiles(id), type text not null, message text not null, created_at timestamptz not null default now());
create index events_room_time on public.room_events(room_id, created_at desc);

create function public.is_room_member(p_room uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from room_members m join profile_access a on a.profile_id = m.user_id where m.room_id = p_room and a.auth_user_id = auth.uid());
$$;
create function public.current_profile_id() returns uuid language sql stable security definer set search_path = public as $$
  select profile_id from profile_access where auth_user_id = auth.uid();
$$;
create function public.unlock_identity(p_name text, p_passcode text) returns uuid language plpgsql security definer set search_path = public, private, extensions as $$
declare profile_uuid uuid; saved_hash text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.id, s.passcode_hash into profile_uuid, saved_hash from public.profiles p join private.identity_secrets s on s.profile_id = p.id where p.display_name = p_name;
  if saved_hash is null or extensions.crypt(p_passcode, saved_hash) <> saved_hash then raise exception 'Invalid passcode'; end if;
  insert into public.profile_access(auth_user_id, profile_id) values(auth.uid(), profile_uuid)
    on conflict(auth_user_id) do update set profile_id = excluded.profile_id;
  return profile_uuid;
end;
$$;
revoke all on function public.unlock_identity(text, text) from public, anon;
grant execute on function public.unlock_identity(text, text) to authenticated;
create function public.can_read_session(p_session uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from study_sessions where id = p_session and is_room_member(room_id));
$$;

alter table public.profiles enable row level security;
alter table public.profile_access enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_breaks enable row level security;
alter table public.daily_goals enable row level security;
alter table public.room_events enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id = public.current_profile_id() or exists(select 1 from public.room_members m where m.user_id = profiles.id and public.is_room_member(m.room_id)));
create policy profile_access_read on public.profile_access for select to authenticated using (auth_user_id = auth.uid());
create policy rooms_read on public.rooms for select to authenticated using (public.is_room_member(id));
create policy members_read on public.room_members for select to authenticated using (public.is_room_member(room_id));
create policy sessions_read on public.study_sessions for select to authenticated using (public.is_room_member(room_id));
create policy breaks_read on public.study_breaks for select to authenticated using (public.can_read_session(session_id));
create policy goals_read on public.daily_goals for select to authenticated using (public.is_room_member(room_id));
create policy events_read on public.room_events for select to authenticated using (public.is_room_member(room_id));

create function public.room_action(p_room uuid, p_action text, p_subject text default null, p_target_minutes integer default null, p_date date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare s public.study_sessions%rowtype; b public.study_breaks%rowtype; person text; event_text text; actor uuid;
begin
  if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'Not a room member'; end if;
  actor := public.current_profile_id();
  select display_name into person from public.profiles where id = actor;
  if p_action = 'goal' then
    if p_target_minutes is null or p_target_minutes not between 1 and 1440 then raise exception 'Invalid goal'; end if;
    insert into public.daily_goals(room_id, date, target_minutes) values(p_room, p_date, p_target_minutes)
      on conflict(room_id, date) do update set target_minutes = excluded.target_minutes;
    return;
  end if;
  select * into s from public.study_sessions where room_id = p_room and user_id = actor and ended_at is null for update;
  if p_action = 'start' then
    if found then raise exception 'Session already active'; end if;
    insert into public.study_sessions(room_id, user_id, subject) values(p_room, actor, nullif(left(trim(p_subject), 120), ''));
    event_text := person || ' started studying.';
  elsif p_action = 'break' then
    if s.id is null then raise exception 'No active session'; end if;
    if exists(select 1 from public.study_breaks where session_id = s.id and ended_at is null) then raise exception 'Already on break'; end if;
    insert into public.study_breaks(session_id) values(s.id);
    event_text := person || ' is taking a break.';
  elsif p_action = 'resume' then
    if s.id is null then raise exception 'No active session'; end if;
    select * into b from public.study_breaks where session_id = s.id and ended_at is null for update;
    if b.id is null then raise exception 'Not on break'; end if;
    update public.study_breaks set ended_at = now() where id = b.id;
    event_text := person || ' resumed studying.';
  elsif p_action = 'finish' then
    if s.id is null then raise exception 'No active session'; end if;
    update public.study_breaks set ended_at = now() where session_id = s.id and ended_at is null;
    update public.study_sessions set ended_at = now() where id = s.id;
    event_text := person || ' finished a session.';
  else raise exception 'Unknown action';
  end if;
  insert into public.room_events(room_id, user_id, type, message) values(p_room, actor, p_action, event_text);
end;
$$;
revoke all on function public.room_action(uuid, text, text, integer, date) from public, anon;
grant execute on function public.room_action(uuid, text, text, integer, date) to authenticated;

alter publication supabase_realtime add table public.study_sessions, public.study_breaks, public.daily_goals, public.room_events;

-- Private Presence channels use the room UUID in their topic.
create policy room_presence_read on realtime.messages for select to authenticated
using (split_part(realtime.topic(), ':', 1) = 'room' and public.is_room_member(split_part(realtime.topic(), ':', 2)::uuid));
create policy room_presence_write on realtime.messages for insert to authenticated
with check (split_part(realtime.topic(), ':', 1) = 'room' and public.is_room_member(split_part(realtime.topic(), ':', 2)::uuid));
