alter table public.notifications add column title text check (char_length(title) between 1 and 300);

create function private.festival_notification_body(p_event jsonb,p_city_id text) returns text
language plpgsql stable security definer set search_path='' as $$
declare intro text; segment text:=p_event->>'segment'; genre text:=p_event->>'genre'; kind text; place text; day text; zone text;
begin
  intro:=btrim(regexp_replace(regexp_replace(coalesce(p_event->>'description',''),'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g'));
  -- Upstream introductions sometimes contain only admission rules or venue advertising.
  select coalesce(string_agg(sentence,' ' order by position),'') into intro
  from regexp_split_to_table(intro,'(?<=[.!?])[[:space:]]+') with ordinality s(sentence,position)
  where char_length(sentence)>=8 and sentence !~* '(refund|exchanges? permitted|non-refundable|government.{0,12}id|valid.{0,8}(photo|id)|[0-9]{2}\+|all ages|ticket limit|vip package|환불|신분증)';
  if intro='' or intro ~* '(hotel|resort|casino)' then
    kind:=case segment
      when 'Music' then coalesce(case genre when 'Rock' then '록' when 'Pop' then '팝' when 'Jazz' then '재즈'
        when 'Hip-Hop/Rap' then '힙합' when 'Dance/Electronic' then '전자음악' when 'Classical' then '클래식'
        when 'Country' then '컨트리' when 'Metal' then '메탈' when 'Folk' then '포크' when 'Reggae' then '레게' end||' 공연','음악 공연')
      when 'Sports' then coalesce(case genre when 'Basketball' then '농구' when 'Hockey' then '아이스하키'
        when 'Baseball' then '야구' when 'Soccer' then '축구' when 'Football' then '미식축구' when 'Tennis' then '테니스' end||' 경기','스포츠 경기')
      when 'Arts & Theatre' then case genre when 'Comedy' then '코미디 공연' when 'Theatre' then '연극 공연' when 'Dance' then '무용 공연' else '공연' end
      when 'Film' then '영화 상영 행사' else '행사' end;
    select timezone into zone from public.cities where id=p_city_id;
    if pg_input_is_valid(p_event->>'startsAt','timestamp with time zone') then
      day:=to_char((p_event->>'startsAt')::timestamptz at time zone coalesce(zone,'UTC'),'FMMM"월 "FMDD"일 "HH24:MI');
    end if;
    place:=nullif(btrim(regexp_replace(coalesce(p_event->>'venue',''),'<[^>]*>|[[:space:][:cntrl:]]+',' ','g')),'');
    if place is null then select name into place from public.cities where id=p_city_id; end if;
    intro:=kind||case when right(kind,2)='공연' then '이에요. ' else '예요. ' end||concat_ws(', ',day,case when place is not null then place||'에서 열려요.' end);
  end if;
  return left(btrim(intro),165)||case when char_length(intro)>165 then '…' else '' end||' 같이 갈 사람!?';
end;
$$;
alter function private.festival_notification_body(jsonb,text) owner to postgres;
revoke all on function private.festival_notification_body(jsonb,text) from public,anon,authenticated,service_role;

create function private.stamp_festival_notification_content() returns trigger
language plpgsql security definer set search_path='' as $$
declare event record; details jsonb;
begin
  select * into event from private.ticketmaster_notification_events where target_id=new.target_id;
  if not found then return null; end if;
  details:=private.cached_ticketmaster_event(event.city_id,event.event_id);
  if details is null then return null; end if;
  new.title:=left(btrim(regexp_replace(regexp_replace(event.name,'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g')),300);
  if new.title='' then return null; end if;
  new.body:=private.festival_notification_body(details,event.city_id);
  return new;
end;
$$;
alter function private.stamp_festival_notification_content() owner to postgres;
revoke all on function private.stamp_festival_notification_content() from public,anon,authenticated,service_role;
-- Existing preference/city/budget filtering runs first, before reading event content.
create trigger notifications_ticketmaster_content before insert on public.notifications
  for each row when (new.target_type='ticketmaster_event') execute function private.stamp_festival_notification_content();

-- Preserve historical/read alerts and queue identities; do not resend old recommendations.
update public.notifications n set
  title=left(btrim(regexp_replace(regexp_replace(e.name,'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g')),300),
  body=private.festival_notification_body(private.cached_ticketmaster_event(e.city_id,e.event_id),e.city_id)
from private.ticketmaster_notification_events e
where n.target_type='ticketmaster_event' and n.target_id=e.target_id and n.read_at is null;

create or replace view public.user_notifications with (security_invoker=true) as
  select n.* from public.notifications n where private.can_read_notification(n);

-- Extend the existing service-only claim, retaining leases and every delivery guard.
do $content$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  anchor:='post_preview text)';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'EVENT_CLAIM_HEADER_CHANGED'; end if;
  definition:=replace(definition,anchor,'post_preview text, event_title text)');
  anchor:=E'\n      from private.push_devices';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'EVENT_CLAIM_FIELDS_CHANGED'; end if;
  definition:=replace(definition,anchor,$title$,
      case when preview_event.target_id is not null then left(btrim(regexp_replace(regexp_replace(preview_event.name,'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g')),300) end
      from private.push_devices$title$);
  anchor:='else n.body end,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'EVENT_CLAIM_BODY_CHANGED'; end if;
  definition:=replace(definition,anchor,$body$else case when preview_event.target_id is not null
        then private.festival_notification_body(private.cached_ticketmaster_event(preview_event.city_id,preview_event.event_id),preview_event.city_id)
        when n.target_type='ticketmaster_event' then null else n.body end end,$body$);
  anchor:='left join public.profiles sender on sender.id=m.sender_id';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'EVENT_CLAIM_JOIN_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||$join$
      left join private.ticketmaster_notification_events preview_event on p_phase='send' and n.target_type='ticketmaster_event'
        and preview_event.target_id=n.target_id and n.category in ('trending','city_places')$join$);
  drop function public.claim_push_notifications(text,integer);
  execute definition;
  alter function public.claim_push_notifications(text,integer) owner to postgres;
  revoke all on function public.claim_push_notifications(text,integer) from public,anon,authenticated,service_role;
  grant execute on function public.claim_push_notifications(text,integer) to service_role;
end;
$content$;
notify pgrst,'reload schema';
