-- Owner 2026-10-30 (web upgrade mockup ④): guests and crawlers may read the opening of a public post (300–500 chars)
-- plus its date, comment count and display name. The rest of the body stays login-gated; meetups never expose a body.
-- The lines go through the same contact/link/HTML filters as the share-card teaser.
create or replace function private.public_post_preview(p_body text, p_title text) returns text
language sql immutable set search_path='' as $$
  select nullif(case when char_length(joined)>500 then left(joined,499)||'…' else joined end,'')
  from (
    select string_agg(line,E'\n' order by ordinal) as joined
    from (
      select line, ordinal, coalesce(sum(char_length(line)) over (order by ordinal rows between unbounded preceding and 1 preceding),0) as before
      from (
        select btrim(regexp_replace(raw_line,'[[:space:]]+',' ','g')) as line, ordinal
        from regexp_split_to_table(
          regexp_replace(
            regexp_replace(
              split_part(split_part(split_part(split_part(coalesce(p_body,''),
                '첨부 링크',1),'사진 출처·이용 조건',1),'Google 지도:',1),'<!--',1),
              '(?:<(script|style)\M[^>]*>.*?</\1[[:space:]]*>){1,1}?','','gis'),
            '<(script|style)\M.*$','','gis'),
          E'[\r\n  ]+') with ordinality as lines(raw_line,ordinal)
      ) as candidate
      where line<>'' and line<>coalesce(p_title,'')
        and line !~ '[<>{}]'
        and line !~* '([[:alpha:]][[:alnum:]+.-]*://|www\.|mailto:|tel:|@|전화|연락처|문의|카카오|카톡|인스타|instagram|whatsapp|telegram|discord|contact|디엠)'
        and line !~* '^(첨부 링크|사진 출처|출처|원문|위치|주소|photo credit|image credit|source)[[:space:]:·]'
        and line !~ '\+?[0-9][0-9[:space:]().-]{6,}[0-9]|[-+]?[0-9]{1,3}\.[0-9]{3,}'
    ) as running
    where before<300
  ) as preview;
$$;
revoke all on function private.public_post_preview(text,text) from public,anon,authenticated,service_role;
alter function private.public_post_preview(text,text) owner to postgres;

do $migration$
declare
  definition text := pg_get_functiondef('public.get_shared_link_preview(uuid)'::regprocedure);
  anchor text := '''teaser'',';
begin
  if (select count(*) from regexp_matches(definition,anchor,'g'))<>1
    or position('join public.profiles a on a.id=p.author_id' in definition)=0
    or position('private.business_public_posts' in definition)=0
    or position('''preview''' in definition)>0 then
    raise exception 'shared preview projection changed; review before extending';
  end if;
  execute replace(definition,anchor,$projection$'preview',case when p.room_preview is null and t.kind<>'meetup' then private.public_post_preview(p.body,p.title) end,
    'createdAt',p.created_at,'commentCount',p.comment_count,
    'author',case when p.business_author_id is null then a.nickname::text else (select m.name from private.merchants m where m.id=p.business_author_id) end,
    'authorIsBusiness',p.business_author_id is not null,
    'teaser',$projection$);
end $migration$;
notify pgrst,'reload schema';
