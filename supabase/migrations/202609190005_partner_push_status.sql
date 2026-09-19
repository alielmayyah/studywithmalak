-- Function allowing room members to check if their study partner has push notifications active.
create or replace function public.partner_push_status(p_room uuid)
returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (
    select 1 from public.push_subscriptions ps
    join public.room_members partner on partner.room_id = p_room and partner.user_id = ps.profile_id
    where partner.user_id <> public.current_profile_id()
      and public.is_room_member(p_room)
  );
$$;

revoke all on function public.partner_push_status(uuid) from public, anon;
grant execute on function public.partner_push_status(uuid) to authenticated;
