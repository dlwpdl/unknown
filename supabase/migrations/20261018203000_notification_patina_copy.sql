-- Patina-reviewed copy: facts form one sentence; decorative introductions repeat the event category.
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
    intro:=concat_ws(' ',case when day is not null then day||',' end,case when place is not null then place||'에서' end,
      kind||case when right(kind,2)='공연' then '이' else '가' end)||' 열려요.';
  end if;
  return btrim(intro);
end;
$$;
alter function private.festival_notification_body(jsonb,text) owner to postgres;
revoke all on function private.festival_notification_body(jsonb,text) from public,anon,authenticated,service_role;

create or replace function private.event_recommendation_body(p_user_id uuid,p_event jsonb,p_city_id text,p_existing_body text default null)
returns text language plpgsql security definer set search_path='' as $$
declare facts text; parts text[]; previous text; chosen integer:=0; result text;
begin
  facts:=private.festival_notification_body(p_event,p_city_id);
  parts:=regexp_match(facts,'^([0-9]{1,2}월 [0-9]{1,2}일), (.+)에서 (.+) 열려요\.$');
  -- Keep a useful source sentence intact, and never invent missing date or place details.
  if parts is null or strpos(regexp_replace(regexp_replace(coalesce(p_event->>'description',''),
    '<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g'),facts)>0 then return facts; end if;
  if p_existing_body is not null then
    previous:=p_existing_body;
  else
    select n.body into previous from public.notifications n
    where n.user_id=p_user_id and n.target_type='ticketmaster_event'
      and n.kind in ('trending_post','city_places') and n.created_at>now()-interval '7 days'
    order by n.created_at desc,n.id desc limit 1;
  end if;
  if previous ~ ' 열려요\.$| 열릴 예정이에요\.$' and previous !~ '^(행사 소식이에요|일정을 살펴봐요|이런 행사도 있어요|외출 계획에 참고해요)\.' then
    chosen:=case when previous ~ '^[0-9]{1,2}월 [0-9]{1,2}일, ' then 0 else 1 end
      +case when previous like '% 열릴 예정이에요.' then 2 else 0 end;
    if p_existing_body is null then chosen:=mod(chosen+1,4); end if;
  end if;
  result:=case chosen
    when 0 then facts
    when 1 then parts[2]||'에서 '||parts[1]||'에 '||parts[3]||' 열려요.'
    when 2 then parts[1]||', '||parts[2]||'에서 '||parts[3]||' 열릴 예정이에요.'
    when 3 then parts[2]||'에서 '||parts[1]||'에 '||parts[3]||' 열릴 예정이에요.'
  end;
  if char_length(result)>90 then return facts; end if;
  return result;
end;
$$;
alter function private.event_recommendation_body(uuid,jsonb,text,text) owner to postgres;
revoke all on function private.event_recommendation_body(uuid,jsonb,text,text) from public,anon,authenticated,service_role;
