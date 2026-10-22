-- Expose the existing partial-index predicates without changing visibility or hashtag matching.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_public_feed_page_v2(text,smallint,text,timestamptz,uuid,integer)'::regprocedure);
  anchor:='where private.listing_alive(post.kind, post.status, post.listing_status, post.expires_at)';
  if position(anchor in definition)=0 then raise exception 'Missing V2 feed visibility anchor'; end if;
  definition:=replace(definition,anchor,
    'where post.status = ''published'' and private.listing_alive(post.kind, post.status, post.listing_status, post.expires_at)');
  anchor:='and exists(select 1 from unnest(post.hashtags) hashtag where hashtag ilike ''%''||q||''%'')';
  if position(anchor in definition)=0 then raise exception 'Missing V2 feed hashtag anchor'; end if;
  definition:=replace(definition,anchor,
    'and private.hashtag_search_text(post.hashtags) ilike ''%''||q||''%%''
        '||anchor);
  execute definition;

  -- A terminal query escape must leave a wildcard after the matched hashtag.
  definition:=pg_get_functiondef('public.get_public_feed_page(text,smallint,text,timestamptz,uuid,integer)'::regprocedure);
  anchor:='private.hashtag_search_text(post.hashtags) ilike ''%''||trim(p_query)||''%''';
  if position(anchor in definition)=0 then raise exception 'Missing legacy feed hashtag anchor'; end if;
  execute replace(definition,anchor,
    'private.hashtag_search_text(post.hashtags) ilike ''%''||trim(p_query)||''%%''');
end $$;
