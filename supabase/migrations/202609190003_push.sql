-- Push notification support: subscriptions, delivery log, due-notification query, and cron dispatcher.

-- Store per-device Web Push subscriptions.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique(profile_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

-- Users can read and manage their own subscriptions.
create policy push_sub_select on public.push_subscriptions
  for select to authenticated
  using (profile_id = public.current_profile_id());

create policy push_sub_insert on public.push_subscriptions
  for insert to authenticated
  with check (profile_id = public.current_profile_id());

create policy push_sub_delete on public.push_subscriptions
  for delete to authenticated
  using (profile_id = public.current_profile_id());

-- Log sent push notifications to prevent duplicates.
create table private.push_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  phase text not null,
  deadline_at timestamptz not null,
  sent_at timestamptz not null default now(),
  unique(profile_id, phase, deadline_at)
);

-- Find timers whose deadline has passed (within a 2-minute window) and that
-- have not yet been dispatched. Returns one row per profile that needs a push.
create function private.due_push_notifications()
returns table(profile_id uuid, phase text, deadline_at timestamptz, display_name text)
language sql stable security definer set search_path = public, private as $$
  select
    ps.user_id as profile_id,
    ps.phase,
    (ps.phase_started_at + ps.remaining_ms * interval '1 millisecond') as deadline_at,
    p.display_name
  from public.pomodoro_states ps
  join public.profiles p on p.id = ps.user_id
  where ps.run_state = 'running'
    and ps.phase_started_at is not null
    and (ps.phase_started_at + ps.remaining_ms * interval '1 millisecond') <= now()
    and (ps.phase_started_at + ps.remaining_ms * interval '1 millisecond') > now() - interval '2 minutes'
    and not exists (
      select 1 from private.push_log pl
      where pl.profile_id = ps.user_id
        and pl.phase = ps.phase
        and pl.deadline_at = (ps.phase_started_at + ps.remaining_ms * interval '1 millisecond')
    )
    and exists (
      select 1 from public.push_subscriptions sub
      where sub.profile_id = ps.user_id
    );
$$;
revoke all on function private.due_push_notifications() from public, anon, authenticated;

-- Public RPC wrappers for the Edge Function (service-role only, all revoked from authenticated).
create function public.due_push_notifications()
returns table(profile_id uuid, phase text, deadline_at timestamptz, display_name text)
language sql stable security definer set search_path = public, private as $$
  select * from private.due_push_notifications();
$$;
revoke all on function public.due_push_notifications() from public, anon, authenticated;

create function public.log_push_delivery(
  p_profile_id uuid, p_phase text, p_deadline_at timestamptz
) returns void language sql security definer set search_path = private as $$
  insert into private.push_log(profile_id, phase, deadline_at)
  values(p_profile_id, p_phase, p_deadline_at)
  on conflict do nothing;
$$;
revoke all on function public.log_push_delivery(uuid, text, timestamptz) from public, anon, authenticated;

create function public.cleanup_push_log()
returns void language sql security definer set search_path = private as $$
  delete from private.push_log where sent_at < now() - interval '1 hour';
$$;
revoke all on function public.cleanup_push_log() from public, anon, authenticated;

-- Enable the pg_net extension (needed for cron → Edge Function HTTP calls).
create extension if not exists pg_net with schema extensions;

-- pg_cron job is set up separately via scripts/setup-cron.ts because it
-- requires the Edge Function URL and service role key.
-- See scripts/setup-cron.ts for the cron.schedule() call.
