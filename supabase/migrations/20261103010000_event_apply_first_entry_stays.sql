-- PR #84 security review (2026-11-03): typing someone's handle into the apply form again can no longer change what they sent,
-- and the hourly cap no longer rests on an IP header the caller writes. Same signature, so the owner and the
-- service_role-only grant from 20261102120000 stay.
-- - The first form for a handle is what the business sees. A later form for that handle changes nothing and gets the same
--   answer, so the page never says whether someone applied; to change anything they DM us. Someone added on the event board
--   who has not sent the form yet still has their answers filled in, once.
-- - A later form with different answers (re-review 2026-11-03: it may be the person correcting an allergy, or someone else)
--   puts the row in the board's "check again" (needs_check) and keeps the new answers in partnership_events as
--   participation_apply_conflict, once until the board clears the flag. The board then confirms by DM.
-- - p_ip_sha256 is null when no client IP reached the function; then only the per-event cap applies.
-- - Past 30 link entries an hour, whatever the IPs, an event still takes entries but each one goes to the board's check-again
--   list (re-review 2026-11-03: refusing at 30 let three IPs shut the link). At 300 an hour it stops ('busy', the page says it
--   could not send), which bounds what a flood can write.
create or replace function public.event_apply(p_slug text,p_handle text,p_slots jsonb,p_party integer,p_allergies text,p_reel_days integer,
  p_language text,p_ip_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; handle text; city text; today date; cfg private.partnership_apply_settings; allergy text:=btrim(p_allergies);
  url text; crid uuid; pid uuid; flagged uuid; again boolean:=false; capped boolean; burst boolean;
begin
  if p_ip_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_EVENT_LINK'; end if;
  if p_ip_sha256 is not null then
    perform pg_advisory_xact_lock(hashtextextended('event_apply:'||p_ip_sha256,0));
    delete from private.partnership_apply_attempts where created_at<clock_timestamp()-interval '1 hour';
    if (select count(*) from private.partnership_apply_attempts where ip_sha256=p_ip_sha256)>=10 then
      return jsonb_build_object('ok',false,'error','rate_limited');
    end if;
    insert into private.partnership_apply_attempts(ip_sha256) values(p_ip_sha256);
  end if;
  cid:=private.event_link_campaign('apply',p_slug);
  if cid is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  handle:=private.event_handle(p_handle);
  select m.city_id,(clock_timestamp() at time zone z.timezone)::date into city,today
    from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id where c.id=cid;
  select * into cfg from private.partnership_apply_settings where campaign_id=cid;
  if cfg.campaign_id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if not coalesce(handle is not null and p_language in ('en','ko')
      and p_party between 1 and cfg.party_max and p_reel_days between 1 and cfg.reel_days_max
      and (p_allergies is null or length(allergy) between 1 and 200)
      and private.event_slots_ok(p_slots,cfg.visit_dates,cfg.time_slots,today),false) then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  -- Before the handle is looked up, so over the cap a repeat and a new name get the same answer.
  perform pg_advisory_xact_lock(hashtextextended('event_apply_campaign:'||cid,0));
  select count(*)>=300,count(*)>=30 into capped,burst from private.partnership_participations
    where campaign_id=cid and applied_via='apply_link' and applied_at>clock_timestamp()-interval '1 hour';
  if capped then return jsonb_build_object('ok',false,'error','busy'); end if;
  url:='https://www.instagram.com/'||handle||'/';
  insert into private.partnership_creators(id,display_name,city_id,profile_url) values(gen_random_uuid(),handle,city,url)
    on conflict ((private.partnership_profile_key(profile_url))) do nothing;
  select id into crid from private.partnership_creators where private.partnership_profile_key(profile_url)=private.partnership_profile_key(url);
  insert into private.partnership_participations(id,campaign_id,creator_id,applied_via,language,applied_at,
      preferred_slots,party_size,has_allergies,allergies,reel_within_days,dm_channel,needs_check)
    values(gen_random_uuid(),cid,crid,'apply_link',p_language,clock_timestamp(),p_slots,p_party,p_allergies is not null,allergy,p_reel_days,'instagram',burst)
    on conflict(campaign_id,creator_id) do nothing returning id into pid;
  if pid is null then
    again:=true;
    -- Only a board-added person who has never sent the form (no applied_at), and only while nobody has picked them.
    update private.partnership_participations p set applied_via='apply_link',language=p_language,applied_at=clock_timestamp(),
      preferred_slots=p_slots,party_size=p_party,has_allergies=p_allergies is not null,allergies=allergy,reel_within_days=p_reel_days,
      dm_channel=coalesce(p.dm_channel,'instagram'),needs_check=p.needs_check or burst,
      updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
      where p.campaign_id=cid and p.creator_id=crid and p.applied_at is null and p.stage='applied'
        and coalesce(to_jsonb(p)->>'outreach_stage','candidate') in ('candidate','proposed','replied') and not private.event_winner(p)
      returning p.id into pid;
    if pid is null then
      update private.partnership_participations p set needs_check=true,updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
        where p.campaign_id=cid and p.creator_id=crid and not p.needs_check
          and (p.preferred_slots,p.party_size,p.has_allergies,p.allergies,p.reel_within_days)
            is distinct from (p_slots,p_party,p_allergies is not null,allergy,p_reel_days)
        returning p.id into flagged;
      if flagged is not null then
        insert into private.partnership_events(actor_id,resource_id,action,details) values(null,flagged,'participation_apply_conflict',
          jsonb_build_object('kind','participation','campaign_id',cid,'creator_id',crid,'source','apply_link','language',p_language,
            'slots',p_slots,'party',p_party,'has_allergies',p_allergies is not null,'allergies',allergy,'reel_days',p_reel_days));
      end if;
    end if;
  end if;
  if pid is not null then
    insert into private.partnership_events(actor_id,resource_id,action,details) values(null,pid,'participation_applied',
      jsonb_build_object('kind','participation','campaign_id',cid,'creator_id',crid,'stage','applied','source','apply_link','again',again));
  end if;
  return jsonb_build_object('ok',true,'already',again);
end $$;
notify pgrst,'reload schema';
