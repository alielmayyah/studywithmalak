-- Partner start push notification support
-- When a user starts focusing, notify their room partner if the partner isn't already studying.

create or replace function private.partner_start_notifications()
returns table(
  notify_profile_id uuid,
  starter_name text,
  started_at timestamptz
)
language sql stable security definer set search_path = public, private as $$
  select
    partner.user_id as notify_profile_id,
    starter_profile.display_name as starter_name,
    ps.phase_started_at as started_at
  from public.pomodoro_states ps
  join public.profiles starter_profile on starter_profile.id = ps.user_id
  join public.room_members rm on rm.room_id = ps.room_id and rm.user_id = ps.user_id
  join public.room_members partner on partner.room_id = ps.room_id and partner.user_id <> ps.user_id
  where ps.phase = 'focus'
    and ps.run_state = 'running'
    and ps.phase_started_at is not null
    and ps.phase_started_at > now() - interval '2 minutes'
    -- Don't notify if partner is also already focusing
    and not exists (
      select 1 from public.pomodoro_states partner_ps
      where partner_ps.user_id = partner.user_id
        and partner_ps.room_id = ps.room_id
        and partner_ps.phase = 'focus'
        and partner_ps.run_state in ('running', 'paused')
    )
    -- Don't re-notify for the same start event
    and not exists (
      select 1 from private.push_log pl
      where pl.profile_id = partner.user_id
        and pl.phase = 'partner_start'
        and pl.deadline_at = ps.phase_started_at
    )
    -- Only if the partner has push subscriptions
    and exists (
      select 1 from public.push_subscriptions sub
      where sub.profile_id = partner.user_id
    );
$$;
revoke all on function private.partner_start_notifications() from public, anon, authenticated;

-- Public RPC wrapper for the Edge Function
create or replace function public.partner_start_notifications()
returns table(notify_profile_id uuid, starter_name text, started_at timestamptz)
language sql stable security definer set search_path = public, private as $$
  select * from private.partner_start_notifications();
$$;
revoke all on function public.partner_start_notifications() from public, anon, authenticated;
