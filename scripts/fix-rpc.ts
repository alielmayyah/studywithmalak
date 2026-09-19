const ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
const sql = `
create or replace function public.log_push_delivery(
  p_profile_id uuid, p_phase text, p_deadline_at timestamptz
) returns void language sql security definer set search_path = private as $$
  insert into private.push_log(profile_id, phase, deadline_at)
  values(p_profile_id, p_phase, p_deadline_at)
  on conflict do nothing;
$$;
revoke all on function public.log_push_delivery(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.cleanup_push_log()
returns void language sql security definer set search_path = private as $$
  delete from private.push_log where sent_at < now() - interval '1 hour';
$$;
revoke all on function public.cleanup_push_log() from public, anon, authenticated;
`;
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});
console.log(res.status, await res.text());
