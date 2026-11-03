-- Event board, step 2 (owner 2026-11-02 "컨펌 답 (크리에이터 보드 아이디어)": all seven ideas "넣기"; mockup
-- output/design/gling-admin-event-board-v2-20261102). Runs after mobile 20261102130000_event_board_phase2, whose columns,
-- helpers and save functions this reads (contract: output/reviews/influencer-event-automation-2026-11-02/phase2-contract.md).
-- Board body is 20261102010000_admin_event_board_restore plus the new fields; nothing it returned before changes.

create or replace function public.get_admin_event_board() returns jsonb
language plpgsql security definer set search_path='' as $$
declare campaigns jsonb; creators jsonb; more boolean;
begin
  perform private.lock_partnership_actor();
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'merchant_name',m.name,
      'team_limit',c.team_limit,'ends_on',c.ends_on,'deadline_note',c.deadline_note,
      'days_left',c.ends_on-(clock_timestamp() at time zone z.timezone)::date,
      -- The browser turns an applicant's picked date and time into scheduled_at in this zone (database tzdata can lag).
      'merchant_id',m.id,'timezone',z.timezone,
      -- Events with apply settings take entries by link: their first two columns read 신청 / 당첨.
      'apply_link',s.campaign_id is not null,'late_gets_benefit',coalesce(s.late_gets_benefit,false),
      'event_profile',(select jsonb_build_object('instagram',x.instagram,'ig_location_id',x.ig_location_id,'ig_location_name',x.ig_location_name,
          'updated_at',x.updated_at) from private.merchant_event_profiles x where x.merchant_id=m.id),
      -- The applicants' benefit request_event_result looks for: active first, else the latest one to finish setting up.
      'benefit',(select jsonb_build_object('id',b.id,'title',b.title,'status',b.status,'discount_percent',b.discount_percent,
          'starts_on',b.starts_on,'expires_on',b.expires_on,'max_discount_cents',b.max_discount_cents,'weekdays',b.weekdays,
          'dine_in_only',b.dine_in_only,'checkout_note',b.checkout_note,'updated_at',b.updated_at)
        from private.partnership_benefits b where b.campaign_id=c.id and b.audience='creators'
        order by b.status='active' desc,b.updated_at desc,b.id limit 1),
      'result_post',(select jsonb_build_object('id',r.id,'status',r.status,'permalink',r.permalink,'created_at',r.created_at,
          'published_at',r.published_at) from private.partnership_result_posts r where r.campaign_id=c.id order by r.created_at desc,r.id limit 1),
      -- A template counts as approved only while its approval hash is set; the table clears it when the text changes.
      'dm_templates',(select coalesce(jsonb_agg(jsonb_build_object('dm_group',t.dm_group,'language',t.language,'body',t.body,
          'approved',t.approved_sha256 is not null) order by t.dm_group,t.language),'[]')
        from private.partnership_dm_templates t where t.campaign_id=c.id)) order by c.status='closed',c.created_at,c.id),'[]')
    into campaigns
    from (select * from private.partnership_campaigns order by status='closed',created_at,id limit 50) c
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
    left join private.partnership_apply_settings s on s.campaign_id=c.id;
  with page as materialized (select * from private.partnership_creators order by display_name,id limit 2001)
  select coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'display_name',r.display_name,'profile_url',r.profile_url,
      'platforms',r.platforms,'status',r.status,
      -- Only the discovery sync's explicit marker or a Korean-first category counts; otherwise unknown, never "no".
      'korean',r.content_summary like '%한인으로 보임%' or r.category like '한국어 우선%',
      -- Profile numbers the discovery automation reads; null until checked.
      'followers_count',r.followers_count,'recent_reel_avg_views',r.recent_reel_avg_views,'is_private',r.is_private,
      'uses_korean',r.uses_korean,'profile_checked_at',r.profile_checked_at,
      'entries',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'campaign_id',p.campaign_id,'outreach_stage',p.outreach_stage,
          'contacted',p.contacted,'updated_at',p.updated_at,
          -- The board stage a held or dropped card came from, so it can go straight back there.
          'held_from',case when p.outreach_stage in ('hold','dropped') then (select e.details->>'from' from private.partnership_events e
            where e.resource_id=p.id and e.action='participation_outreach_moved' and e.details->>'outreach_stage' in ('hold','dropped')
              and e.details->>'from' in ('candidate','proposed','replied','confirmed','posted') order by e.created_at desc,e.id desc limit 1) end,
          'stage',p.stage,'scheduled_at',p.scheduled_at,
          -- What the applicant sent on the apply page.
          'applied_via',p.applied_via,'language',p.language,'applied_at',p.applied_at,'late',private.event_entry_late(p),
          'preferred_slots',p.preferred_slots,'party_size',p.party_size,'has_allergies',p.has_allergies,'allergies',p.allergies,
          'reel_within_days',p.reel_within_days,
          'drop_reason',p.drop_reason,'needs_check',p.needs_check,
          -- Result DM; dm_claimed_at only says the sender is on it right now.
          'dm_group',p.dm_group,'dm_channel',p.dm_channel,'dm_status',p.dm_status,'dm_sent_at',p.dm_sent_at,'dm_error',p.dm_error,
          'dm_attempts',p.dm_attempts,'dm_claimed_at',p.dm_claimed_at) order by p.created_at,p.id),'[]')
        from private.partnership_participations p where p.creator_id=r.id)) order by r.display_name,r.id)
    from (select * from page order by display_name,id limit 2000) r),'[]'),(select count(*)>2000 from page) into creators,more;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,null);
  return jsonb_build_object('campaigns',campaigns,'creators',creators,'more',more);
end $$;

-- p_dm_group='winner' with 'proposed' is the apply-link pick ("당첨"): it also selects the person (strict stage) and puts them
-- in the winner DM group. Moving a winner back to 'candidate' undoes both. p_scheduled_at with 'confirmed' fills an empty
-- visit time (the browser converts the applicant's first pick) and never overwrites one already set.
-- Old three-argument calls keep their meaning: without p_dm_group the strict stage is never touched.
drop function public.move_admin_event_stage(uuid,text,timestamptz);
create function public.move_admin_event_stage(p_id uuid,p_stage text,p_expected_updated_at timestamptz,
  p_dm_group text default null,p_scheduled_at timestamptz default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p private.partnership_participations; c private.partnership_campaigns; m private.merchants; r private.partnership_creators;
  stamp timestamptz; next_stage text; next_group text; next_time timestamptz;
begin
  perform private.lock_partnership_actor();
  if p_id is null or p_stage is null or p_stage not in ('candidate','proposed','replied','confirmed','posted','hold','dropped')
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    -- The board only ever puts people in the winner group; discount and sorry come from request_event_result.
    or (p_dm_group is not null and (p_dm_group<>'winner' or p_stage<>'proposed'))
    or (p_scheduled_at is not null and (p_stage<>'confirmed' or not isfinite(p_scheduled_at))) then raise exception 'INVALID_PARTNERSHIP'; end if;
  select * into p from private.partnership_participations where id=p_id for update;
  if p.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  if p.updated_at<>p_expected_updated_at then raise exception 'PARTNERSHIP_CHANGED'; end if;
  next_stage:=p.stage; next_group:=p.dm_group; next_time:=coalesce(p.scheduled_at,p_scheduled_at);
  if p_dm_group='winner' and p.dm_group is distinct from 'winner' then
    -- Someone already queued or sent a discount or sorry DM is not silently turned into a winner.
    if p.dm_status is not null or p.stage in ('declined','cancelled') then raise exception 'PARTNERSHIP_STAGE'; end if;
    if p.stage='applied' then
      select * into c from private.partnership_campaigns where id=p.campaign_id for update;
      select * into m from private.merchants where id=c.merchant_id;
      select * into r from private.partnership_creators where id=p.creator_id;
      -- The participation editor's selection rules, without its date check: on an apply-link event ends_on is when
      -- applications close, and winners are picked after that.
      if m.deleted_at is not null or m.record_kind<>'business' or m.consent<>'granted' or m.status='paused' or r.status<>'active'
        or c.status<>'open' then raise exception 'PARTNERSHIP_INACTIVE'; end if;
      if c.team_limit is not null and (select count(*) from private.partnership_participations
        where campaign_id=c.id and stage in ('selected','visited','submitted','completed'))>=c.team_limit then raise exception 'PARTNERSHIP_CAPACITY'; end if;
      next_stage:='selected';
    end if;
    next_group:='winner';
  elsif p_stage='candidate' and p.dm_group='winner' then
    -- Undo only before anything left the board: no DM queued or sent, no visit, no coupon handed out.
    if p.dm_status is not null or p.stage not in ('applied','selected') or exists(select 1 from private.partnership_coupons x
      join private.partnership_benefits y on y.id=x.benefit_id where y.campaign_id=p.campaign_id and x.creator_id=p.creator_id
        and x.status='issued') then raise exception 'PARTNERSHIP_STAGE'; end if;
    next_stage:='applied'; next_group:=null;
  end if;
  if p.outreach_stage=p_stage and next_stage=p.stage and next_group is not distinct from p.dm_group
    and next_time is not distinct from p.scheduled_at then return p_id; end if;
  stamp:=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond');
  -- Once proposed, a person stays "contacted" even if later held or dropped, so nobody is messaged twice.
  update private.partnership_participations set outreach_stage=p_stage,stage=next_stage,dm_group=next_group,scheduled_at=next_time,
    contacted=contacted or p_stage in ('proposed','replied','confirmed','posted'),updated_at=stamp where id=p_id;
  perform public.log_admin_access('analytics',null,p_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_id,'participation_outreach_moved',
    jsonb_strip_nulls(jsonb_build_object('kind','participation','campaign_id',p.campaign_id,'creator_id',p.creator_id,'outreach_stage',p_stage,
      'from',p.outreach_stage,'stage',nullif(next_stage,p.stage),'from_stage',case when next_stage<>p.stage then p.stage end,
      'dm_group',case when next_group is distinct from p.dm_group then coalesce(next_group,'none') end,
      'scheduled_at',case when next_time is distinct from p.scheduled_at then next_time end)));
  -- Same record as a selection in the participation editor, so the event's terms lock exactly as they do there.
  if next_stage='selected' and p.stage='applied' then
    insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_id,'participation_selected',
      jsonb_build_object('kind','participation','campaign_id',p.campaign_id,'creator_id',p.creator_id,'stage','selected','source','event_board'));
  end if;
  return p_id;
end $$;

alter function public.move_admin_event_stage(uuid,text,timestamptz,text,timestamptz) owner to postgres;
revoke all on function public.move_admin_event_stage(uuid,text,timestamptz,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.move_admin_event_stage(uuid,text,timestamptz,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
