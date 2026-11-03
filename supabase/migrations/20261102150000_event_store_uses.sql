-- Counting event discount uses on the store link (owner 2026-11-02 "지모코 사용 세기 다시: 가게 링크 버튼으로 세기"; then "이걸
-- 유저가 다시와서 누르겟냐 … 다시 안볼확률이 99%"). The customer does nothing: when staff check an ID on the store link at the
-- counter and it is on the list, that check is the use. The same ID again within 3 hours is the same visit, and a wrong check
-- can be undone for a day. The event's money total is the business's own discount total, asked once after it ends.
-- Runs after 20261102120000/130000 (and the admin checkout's 135000); it only adds, and asks event_store_lookup who is on the list.
create table private.partnership_store_uses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.partnership_campaigns(id),
  link_id uuid not null references private.partnership_campaign_links(id),
  creator_id uuid not null references private.partnership_creators(id),
  -- Null when only an issued coupon put the person on the list.
  participation_id uuid references private.partnership_participations(id),
  kind text not null check(kind in ('discount','winner')),
  used_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz check(cancelled_at>=used_at)
);
create index partnership_store_uses_creator on private.partnership_store_uses(campaign_id,creator_id,used_at);
alter table private.partnership_store_uses owner to postgres;
alter table private.partnership_store_uses enable row level security;
revoke all on private.partnership_store_uses from public,anon,authenticated,service_role;

-- The lookup's answer plus the record. Only winner and discount are recorded; none and a dead link record nothing.
-- uses: this person's checks in this campaign that were not undone. meal_used: a winner whose free meal already looks used
-- (visited on the board, posted, or an earlier winner check), so staff can ask before giving it twice.
create function public.event_store_check(p_token_sha256 text,p_handle text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare res jsonb:=public.event_store_lookup(p_token_sha256,p_handle); lid uuid; cid uuid; crid uuid; pid uuid; hit uuid;
begin
  if res is null or res->>'status' not in ('winner','discount') then return res; end if;
  select l.id,l.campaign_id into lid,cid from private.partnership_campaign_links l where l.kind='store' and l.token_sha256=p_token_sha256;
  select r.id into crid from private.partnership_creators r
    where private.partnership_profile_key(r.profile_url)='https://instagram.com/'||private.event_handle(p_handle);
  select p.id into pid from private.partnership_participations p where p.campaign_id=cid and p.creator_id=crid;
  -- Two devices checking the same person at once still make one record.
  perform pg_advisory_xact_lock(hashtextextended('event_store_use:'||cid||':'||crid,0));
  select u.id into hit from private.partnership_store_uses u where u.campaign_id=cid and u.creator_id=crid and u.cancelled_at is null
    and u.used_at>clock_timestamp()-interval '3 hours' order by u.used_at desc limit 1;
  if hit is null then
    insert into private.partnership_store_uses(campaign_id,link_id,creator_id,participation_id,kind)
      values(cid,lid,crid,pid,res->>'status') returning id into hit;
  end if;
  res:=res||jsonb_build_object('use_id',hit,'uses',(select count(*) from private.partnership_store_uses u
    where u.campaign_id=cid and u.creator_id=crid and u.cancelled_at is null));
  if res->>'status'='winner' and (exists(select 1 from private.partnership_participations p where p.id=pid
        and (p.stage in ('visited','submitted','completed') or coalesce(to_jsonb(p)->>'outreach_stage','')='posted'))
      or exists(select 1 from private.partnership_store_uses u where u.campaign_id=cid and u.creator_id=crid
        and u.kind='winner' and u.cancelled_at is null and u.id<>hit)) then
    res:=res||'{"meal_used":true}'::jsonb;
  end if;
  return res;
end $$;

-- Undo a wrong check within a day of it, from a live store link of the same campaign. Answers the person's remaining uses.
create function public.event_store_undo(p_token_sha256 text,p_use_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid:=private.event_link_campaign('store',p_token_sha256); crid uuid; done boolean;
begin
  if cid is null then return null; end if;
  select u.creator_id into crid from private.partnership_store_uses u where u.id=p_use_id and u.campaign_id=cid;
  if crid is null then return jsonb_build_object('ok',false); end if;
  perform pg_advisory_xact_lock(hashtextextended('event_store_use:'||cid||':'||crid,0));
  update private.partnership_store_uses set cancelled_at=clock_timestamp()
    where id=p_use_id and cancelled_at is null and used_at>clock_timestamp()-interval '1 day'
    returning true into done;
  return jsonb_build_object('ok',coalesce(done,false),'uses',(select count(*) from private.partnership_store_uses u
    where u.campaign_id=cid and u.creator_id=crid and u.cancelled_at is null));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.event_store_check(text,text)','public.event_store_undo(text,uuid)'] loop
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
grant execute on function public.event_store_check(text,text),public.event_store_undo(text,uuid) to service_role;
notify pgrst,'reload schema';
