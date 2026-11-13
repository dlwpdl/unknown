-- Owner 2026-11-13 (inbox adb25323, abuse test Q1·Q2 both A): one person with several accounts could fill the invite
-- reward by hosting a meetup and confirming the fake accounts there, and Gmail aliases counted as different people.
-- Q1 "초대한 사람 모임은 빼고 세기": an invitee's attendance counts only at a meetup somebody other than the inviter hosted.
-- Q2 "별칭은 같은 메일로, 기기 번호는 참고만": Gmail addresses drop the part after '+' and the dots before comparing.
-- Device marks keep meaning "same person when equal"; a different device never proves a different person.

create or replace function private.invite_marks(p_user uuid) returns text[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(distinct encode(extensions.digest(v, 'sha256'), 'hex')), '{}') from (
    select 'email:'||case when e ~ '@(gmail|googlemail)\.com$'
      then replace(split_part(split_part(e, '@', 1), '+', 1), '.', '')||'@gmail.com' else e end v
      from (select lower(btrim(u.email)) e from auth.users u where u.id = p_user and coalesce(btrim(u.email), '') <> '') m
    union all select 'phone:'||regexp_replace(u.phone, '\D', '', 'g') from auth.users u
      where u.id = p_user and length(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')) >= 7
    union all select 'device:'||d.device_hash from private.account_security_devices d where d.user_id = p_user
  ) s;
$$;

-- Members already rewarded also get their normalized Gmail mark, so a later alias of them is a duplicate.
-- Non-Gmail and plain Gmail marks hash the same as before; on conflict keeps the first owner of a mark.
insert into private.invite_identity_marks(mark, invitee_id)
  select unnest(private.invite_marks(r.invitee_id)), r.invitee_id
  from (select distinct invitee_id from private.invite_identity_marks) r
  on conflict do nothing;

create or replace function private.process_invite_attendance(p_invitee uuid) returns void
language plpgsql security definer set search_path='' as $$
declare red record; host uuid; problem text; tier text; days integer := 0;
begin
  select r.inviter_id, l.merchant_id into red from private.invite_redemptions r join private.invite_links l on l.id = r.link_id
    where r.invitee_id = p_invitee and r.outcome is null for update of r;
  if not found or red.merchant_id is not null then return; end if;
  select s.host_id into host from private.meetup_attendance a join private.meetup_sessions s on s.id = a.session_id
    where a.user_id = p_invitee and a.confirmed_at is not null and s.host_id <> p_invitee and s.host_id <> red.inviter_id
      and (a.confirmation_source <> 'peer' or exists (select 1 from private.meetup_attendance_confirmations c
        where c.session_id = s.id and c.witness_id = s.host_id and c.attendee_id = p_invitee))
    limit 1;
  -- Attendance at the inviter's own meetup leaves the invite waiting for a meetup somebody else hosts.
  if host is null then return; end if;
  problem := case when not private.is_active_account(red.inviter_id) then 'inviter_inactive'
    else private.invite_identity_problem(p_invitee, array[red.inviter_id]) end;
  if problem is null then
    -- An inviter who hosts meetups still gets Pro; only the attendance that counts moved to other hosts.
    tier := case when exists (select 1 from private.meetup_sessions where host_id = red.inviter_id)
      or exists (select 1 from public.posts where author_id = red.inviter_id and room_preview is not null and status = 'published')
      then 'pro' else 'plus' end;
    days := private.grant_invite_reward(red.inviter_id, null, tier, p_invitee, 'attended');
    perform private.record_invite_marks(p_invitee);
  end if;
  update private.invite_redemptions set qualified_at = now(), outcome = coalesce(problem, case when days > 0 then 'rewarded' else 'cap' end)
    where invitee_id = p_invitee;
end $$;
