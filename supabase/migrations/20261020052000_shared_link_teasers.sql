-- Share cards may reveal one short introduction; full posts and all meetup bodies stay gated.
-- Extend the current projection in place, retaining its business-media, visibility and ACL rules.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_shared_link_preview(uuid)'::regprocedure);
  anchor text := '''id''\s*,\s*p\.id\s*,\s*''title''\s*,\s*p\.title\s*,';
  matched text;
  projection text := $projection$'id',p.id,'title',p.title,
    'teaser',case when p.room_preview is null and t.kind<>'meetup' then (
      select case when char_length(line)>120 then left(line,119)||'…' else line end
      from (
        select btrim(regexp_replace(raw_line,'[[:space:]]+',' ','g')) as line, ordinal
        from regexp_split_to_table(
          regexp_replace(
            regexp_replace(
              split_part(split_part(split_part(split_part(coalesce(p.body,''),
                '첨부 링크',1),'사진 출처·이용 조건',1),'Google 지도:',1),'<!--',1),
              '<(script|style)\M[^>]*$','','gis'),
            '<(script|style)\M[^>]*>.*?(</\1[[:space:]]*>|$)','','gis'),
          E'[\r\n\u2028\u2029]+') with ordinality as lines(raw_line,ordinal)
      ) as candidate
      where line<>'' and line<>p.title
        and line !~ '[<>{}]'
        and line !~* '([[:alpha:]][[:alnum:]+.-]*://|www\.|mailto:|tel:|@|전화|연락처|문의|카카오|카톡|인스타|instagram|whatsapp|telegram|discord|contact|디엠)'
        and line !~* '^(첨부 링크|사진 출처|출처|원문|위치|주소|photo credit|image credit|source)[[:space:]:·]'
        and line !~ '\+?[0-9][0-9[:space:]().-]{6,}[0-9]|[-+]?[0-9]{1,3}\.[0-9]{3,}'
      order by ordinal limit 1
    ) end,$projection$;
begin
  if definition !~ 'private\.business_public_posts'
    or position('private.is_blocked_between' in definition)=0
    or position('private.has_reported' in definition)=0
    or position('account_status' in definition)=0
    or position('published' in definition)=0
    or position('business_public_image_paths' in definition)=0
    or position('''teaser''' in definition)>0
    or (select count(*) from regexp_matches(definition,anchor,'g'))<>1 then
    raise exception 'shared preview projection changed; review before extending';
  end if;
  matched:=substring(definition from anchor);
  execute replace(definition,matched,projection);
end $migration$;
notify pgrst,'reload schema';
