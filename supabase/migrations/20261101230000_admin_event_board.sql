-- Event board (owner 2026-11-01 "이벤트보드 너무 좋다 진행해"): outreach steps sit beside the strict
-- participation stage, so selection, capacity, visit and coupon rules stay exactly as they are.
alter table private.partnership_participations
  add column outreach_stage text not null default 'candidate'
    check(outreach_stage in ('candidate','proposed','replied','confirmed','posted','hold','dropped')),
  add column contacted boolean not null default false;

-- Every creator with their per-campaign board entries; the client derives columns, counts and "already contacted".
create function public.get_admin_event_board() returns jsonb
language plpgsql security definer set search_path='' as $$
declare campaigns jsonb; creators jsonb; more boolean;
begin
  perform private.lock_partnership_actor();
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'merchant_name',m.name,
      'team_limit',c.team_limit,'ends_on',c.ends_on,'deadline_note',c.deadline_note,
      'days_left',c.ends_on-(clock_timestamp() at time zone z.timezone)::date) order by c.status='closed',c.created_at,c.id),'[]')
    into campaigns
    from (select * from private.partnership_campaigns order by status='closed',created_at,id limit 50) c
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id;
  with page as materialized (select * from private.partnership_creators order by display_name,id limit 2001)
  select coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'display_name',r.display_name,'profile_url',r.profile_url,
      'platforms',r.platforms,'status',r.status,
      -- Only the discovery sync's explicit marker or a Korean-first category counts; otherwise unknown, never "no".
      'korean',r.content_summary like '%한인으로 보임%' or r.category like '한국어 우선%',
      'entries',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'campaign_id',p.campaign_id,'outreach_stage',p.outreach_stage,
          'contacted',p.contacted,'updated_at',p.updated_at) order by p.created_at,p.id),'[]')
        from private.partnership_participations p where p.creator_id=r.id)) order by r.display_name,r.id)
    from (select * from page order by display_name,id limit 2000) r),'[]'),(select count(*)>2000 from page) into creators,more;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,null);
  return jsonb_build_object('campaigns',campaigns,'creators',creators,'more',more);
end $$;

create function public.move_admin_event_stage(p_id uuid,p_stage text,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare p private.partnership_participations; stamp timestamptz;
begin
  perform private.lock_partnership_actor();
  if p_id is null or p_stage is null or p_stage not in ('candidate','proposed','replied','confirmed','posted','hold','dropped')
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then raise exception 'INVALID_PARTNERSHIP'; end if;
  select * into p from private.partnership_participations where id=p_id for update;
  if p.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  if p.updated_at<>p_expected_updated_at then raise exception 'PARTNERSHIP_CHANGED'; end if;
  if p.outreach_stage=p_stage then return p_id; end if;
  stamp:=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond');
  -- Once proposed, a person stays "contacted" even if later held or dropped, so nobody is messaged twice.
  update private.partnership_participations set outreach_stage=p_stage,
    contacted=contacted or p_stage in ('proposed','replied','confirmed','posted'),updated_at=stamp where id=p_id;
  perform public.log_admin_access('analytics',null,p_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_id,'participation_outreach_moved',
    jsonb_build_object('kind','participation','campaign_id',p.campaign_id,'creator_id',p.creator_id,'outreach_stage',p_stage,'from',p.outreach_stage));
  return p_id;
end $$;

-- Re-adding someone already on this event's board is a no-op, so retries never duplicate.
create function public.add_admin_event_candidates(p_campaign_id uuid,p_creator_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare m private.merchants; cr uuid; rid uuid; added integer:=0;
begin
  perform private.lock_partnership_actor();
  if p_campaign_id is null or p_creator_ids is null or cardinality(p_creator_ids) not between 1 and 100
    or array_position(p_creator_ids,null) is not null then raise exception 'INVALID_PARTNERSHIP'; end if;
  select x.* into m from private.partnership_campaigns c join private.merchants x on x.id=c.merchant_id where c.id=p_campaign_id;
  if m.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  if m.deleted_at is not null or m.record_kind<>'business' then raise exception 'PARTNERSHIP_INACTIVE'; end if;
  if (select count(*) from private.partnership_creators where id=any(p_creator_ids))<>(select count(distinct x) from unnest(p_creator_ids) x) then
    raise exception 'PARTNERSHIP_NOT_FOUND';
  end if;
  perform private.assert_partnership_admin();
  for cr in select distinct x from unnest(p_creator_ids) x order by 1 loop
    insert into private.partnership_participations(id,campaign_id,creator_id) values(gen_random_uuid(),p_campaign_id,cr)
      on conflict(campaign_id,creator_id) do nothing returning id into rid;
    if rid is not null then
      added:=added+1;
      insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),rid,'participation_created',
        jsonb_build_object('kind','participation','campaign_id',p_campaign_id,'creator_id',cr,'stage','applied','outreach_stage','candidate','source','event_board'));
    end if;
  end loop;
  perform public.log_admin_access('analytics',null,p_campaign_id);
  return added;
end $$;

alter function public.get_admin_event_board() owner to postgres;
alter function public.move_admin_event_stage(uuid,text,timestamptz) owner to postgres;
alter function public.add_admin_event_candidates(uuid,uuid[]) owner to postgres;
revoke all on function public.get_admin_event_board(),public.move_admin_event_stage(uuid,text,timestamptz),
  public.add_admin_event_candidates(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_event_board(),public.move_admin_event_stage(uuid,text,timestamptz),
  public.add_admin_event_candidates(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
