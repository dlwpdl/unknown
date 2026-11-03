-- Event board: show how many times the store link counted each person's discount (owner 2026-11-02 "지모코 사용 세기 다시:
-- 가게 링크 버튼으로 세기"). Runs after mobile 20261102150000_event_store_uses; the board body is 20261102135000's plus
-- 'store_uses' on each campaign and entry (checks not undone, counted per campaign and creator like the store link does).

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
      -- Counter checks on the store link that were not undone (mobile 20261102150000).
      'store_uses',(select count(*) from private.partnership_store_uses u where u.campaign_id=c.id and u.cancelled_at is null),
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
          'dm_attempts',p.dm_attempts,'dm_claimed_at',p.dm_claimed_at,
          'store_uses',(select count(*) from private.partnership_store_uses u where u.campaign_id=p.campaign_id and u.creator_id=p.creator_id
            and u.cancelled_at is null)) order by p.created_at,p.id),'[]')
        from private.partnership_participations p where p.creator_id=r.id)) order by r.display_name,r.id)
    from (select * from page order by display_name,id limit 2000) r),'[]'),(select count(*)>2000 from page) into creators,more;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,null);
  return jsonb_build_object('campaigns',campaigns,'creators',creators,'more',more);
end $$;
