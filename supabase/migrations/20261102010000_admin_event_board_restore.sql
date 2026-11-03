-- Event board undo (owner 2026-11-02 "아 그거 고쳐줘"): a card put on hold by mistake returns to the stage it left,
-- instead of restarting from candidate. Read-only change; grants and owner carry over with create or replace.
create or replace function public.get_admin_event_board() returns jsonb
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
          'contacted',p.contacted,'updated_at',p.updated_at,
          -- The board stage a held or dropped card came from, so it can go straight back there.
          'held_from',case when p.outreach_stage in ('hold','dropped') then (select e.details->>'from' from private.partnership_events e
            where e.resource_id=p.id and e.action='participation_outreach_moved' and e.details->>'outreach_stage' in ('hold','dropped')
              and e.details->>'from' in ('candidate','proposed','replied','confirmed','posted') order by e.created_at desc,e.id desc limit 1) end) order by p.created_at,p.id),'[]')
        from private.partnership_participations p where p.creator_id=r.id)) order by r.display_name,r.id)
    from (select * from page order by display_name,id limit 2000) r),'[]'),(select count(*)>2000 from page) into creators,more;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,null);
  return jsonb_build_object('campaigns',campaigns,'creators',creators,'more',more);
end $$;
notify pgrst,'reload schema';
