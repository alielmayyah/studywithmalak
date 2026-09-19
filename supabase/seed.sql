-- Replace both passcode placeholders with long, distinct random passcodes before running.
insert into public.profiles(display_name) values ('Ali'), ('Malak') on conflict(display_name) do nothing;
insert into private.identity_secrets(profile_id, passcode_hash)
select id, extensions.crypt('ALI_PASSCODE_HERE', extensions.gen_salt('bf')) from public.profiles where display_name = 'Ali'
on conflict(profile_id) do update set passcode_hash = excluded.passcode_hash;
insert into private.identity_secrets(profile_id, passcode_hash)
select id, extensions.crypt('MALAK_PASSCODE_HERE', extensions.gen_salt('bf')) from public.profiles where display_name = 'Malak'
on conflict(profile_id) do update set passcode_hash = excluded.passcode_hash;

insert into public.rooms(name) select 'Ali × Malak' where not exists(select 1 from public.rooms where name = 'Ali × Malak');
insert into public.room_members(room_id, user_id)
select r.id, p.id from public.rooms r cross join public.profiles p
where r.name = 'Ali × Malak' and p.display_name in ('Ali', 'Malak')
on conflict do nothing;
