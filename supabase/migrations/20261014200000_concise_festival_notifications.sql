create or replace function private.festival_notification_body(p_event jsonb,p_city_id text) returns text
language plpgsql stable security definer set search_path='' as $$
declare intro text; source text; segment text:=p_event->>'segment'; genre text:=p_event->>'genre'; kind text; place text; day text; zone text;
begin
  source:=btrim(regexp_replace(regexp_replace(coalesce(p_event->>'description',''),'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g'));
  -- Keep one useful Korean sentence; foreign promotions and lists use verified event facts instead.
  select btrim(sentence) into intro
  from regexp_split_to_table(source,'(?<=[.!?])[[:space:]]+') with ordinality s(sentence,position)
  where char_length(sentence) between 8 and 75 and sentence ~ '[가-힣]'
    and btrim(sentence)<>coalesce(p_event->>'name','')
    and sentence !~* '(refund|exchanges? permitted|non-refundable|government.{0,12}id|valid.{0,8}(photo|id)|required\)|[0-9]{2}\+|all ages|ticket limit|vip package|hotel|resort|casino|환불|신분증)'
  order by position limit 1;
  if intro is null then
    kind:=case segment
      when 'Music' then coalesce(case genre when 'Rock' then '록' when 'Pop' then '팝' when 'Jazz' then '재즈'
        when 'Hip-Hop/Rap' then '힙합' when 'Dance/Electronic' then '전자음악' when 'Classical' then '클래식'
        when 'Country' then '컨트리' when 'Metal' then '메탈' when 'Folk' then '포크' when 'Reggae' then '레게' end||' 공연','음악 공연')
      when 'Sports' then coalesce(case genre when 'Basketball' then '농구' when 'Hockey' then '아이스하키'
        when 'Baseball' then '야구' when 'Soccer' then '축구' when 'Football' then '미식축구' when 'Tennis' then '테니스' end||' 경기','스포츠 경기')
      when 'Arts & Theatre' then case genre when 'Comedy' then '코미디 공연' when 'Theatre' then '연극 공연' when 'Dance' then '무용 공연' else '공연' end
      when 'Film' then '영화 상영 행사'
      else case
        when concat_ws(' ',p_event->>'name',source) ~* '\mhalloween\M' then '할로윈 행사'
        when source ~* '\mvideo[[:space:]]+featuring\M|\m(video|film)[[:space:]]+(screening|premiere)\M' then '영상 소개 행사'
        else '행사' end
      end;
    select timezone into zone from public.cities where id=p_city_id;
    if pg_input_is_valid(p_event->>'startsAt','timestamp with time zone') then
      day:=to_char((p_event->>'startsAt')::timestamptz at time zone coalesce(zone,'UTC'),'FMMM"월 "FMDD"일"');
    end if;
    place:=nullif(btrim(regexp_replace(coalesce(p_event->>'venue',''),'<[^>]*>|[[:space:][:cntrl:]]+',' ','g')),'');
    if place is null or char_length(place)>32 then select name into place from public.cities where id=p_city_id; end if;
    intro:=kind||case when right(kind,2)='공연' then '이에요. ' else '예요. ' end||concat_ws(', ',day,case when place is not null then place||'에서 열려요.' end);
  end if;
  return btrim(intro)||' 같이 갈 사람!?';
end;
$$;
alter function private.festival_notification_body(jsonb,text) owner to postgres;
revoke all on function private.festival_notification_body(jsonb,text) from public,anon,authenticated,service_role;

-- Pending/unread alerts reuse their IDs and delivery queue; already delivered pushes are not resent.
update public.notifications n set body=private.festival_notification_body(private.cached_ticketmaster_event(e.city_id,e.event_id),e.city_id)
from private.ticketmaster_notification_events e
where n.target_type='ticketmaster_event' and n.target_id=e.target_id and n.read_at is null
  and n.body is distinct from private.festival_notification_body(private.cached_ticketmaster_event(e.city_id,e.event_id),e.city_id);
