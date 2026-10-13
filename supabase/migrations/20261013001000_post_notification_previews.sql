-- Retain live queue leases, consent/visibility checks, message previews and schedules.
do $preview$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  anchor:='ticket_id text)';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'PUSH_CLAIM_HEADER_CHANGED'; end if;
  definition:=replace(definition,anchor,'ticket_id text, post_title text, post_preview text)');
  anchor:=E'item.ticket_id\n      from private.push_devices';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'PUSH_CLAIM_FIELDS_CHANGED'; end if;
  definition:=replace(definition,anchor,$fields$item.ticket_id,
      case when preview_post.id is not null then trim(regexp_replace(preview_post.title,'[[:space:][:cntrl:]]+',' ','g')) end,
      case when preview_post.id is not null then left(trim(regexp_replace(preview_post.body,'[[:space:][:cntrl:]]+',' ','g')),180)
        ||case when char_length(trim(regexp_replace(preview_post.body,'[[:space:][:cntrl:]]+',' ','g')))>180 then '…' else '' end end
      from private.push_devices$fields$);
  anchor:='left join public.profiles sender on sender.id=m.sender_id';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'PUSH_CLAIM_JOINS_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||$join$
      left join public.posts preview_post on p_phase='send' and n.target_type='post' and preview_post.id=n.target_id
        and n.category in ('trending','weekly_ranking','city_food','city_places','interests','nearby')$join$);
  anchor:='else n.route end,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'PUSH_CLAIM_ROUTE_CHANGED'; end if;
  definition:=replace(definition,anchor,'else case when preview_post.id is not null then ''/post/''||preview_post.id::text else n.route end end,');
  execute 'drop function public.claim_push_notifications(text,integer)';
  execute definition;
  alter function public.claim_push_notifications(text,integer) owner to postgres;
  revoke all on function public.claim_push_notifications(text,integer) from public,anon,authenticated,service_role;
  grant execute on function public.claim_push_notifications(text,integer) to service_role;

  -- Each recipient gets one readable top-five post, stable for the week and retries.
  definition:=pg_get_functiondef('private.publish_weekly_ranking()'::regprocedure);
  anchor:='r.rank = 1';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'WEEKLY_CANDIDATE_CHANGED'; end if;
  definition:=replace(definition,anchor,$weekly$r.rank between 1 and 5 and r.post_id=(
        select candidate.post_id from public.weekly_rankings candidate
        where candidate.city_id=city.city_id and candidate.week_start=week and candidate.rank between 1 and 5
          and private.notification_target_visible(recipient.id,'post',candidate.post_id)
        order by md5(recipient.id::text||week::text||candidate.post_id::text),candidate.rank
        limit 1)$weekly$);
  execute definition;

  definition:=pg_get_functiondef('private.send_trending_notifications()'::regprocedure);
  anchor:='select * into pick from private.trending_candidates(city.city_id, 1);';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'TRENDING_CANDIDATE_CHANGED'; end if;
  definition:=replace(definition,anchor,$trending$select candidate.* into pick from private.trending_candidates(city.city_id, 5) candidate
      where candidate.score>=cfg.min_score
      order by md5(city.city_id||current_date::text||candidate.post_id::text),candidate.post_id limit 1;$trending$);
  execute definition;
end;
$preview$;
notify pgrst,'reload schema';
