-- Keep discovery compatible with shipped clients; bodies, attachments and comments require a user session.
do $$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array[
    'public.get_public_feed(text,integer)',
    'public.get_public_feed_page(text,smallint,text,timestamptz,uuid,integer)',
    'public.get_public_feed_page_v2(text,smallint,text,timestamptz,uuid,integer)',
    'public.get_public_post(uuid)',
    'public.get_public_author_posts(uuid,timestamptz,uuid,integer)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    foreach anchor in array array['post.body','post.image_paths','post.room_preview'] loop
      if strpos(definition,anchor)=0 then raise exception 'login content anchor missing: % %',signature,anchor; end if;
    end loop;
    -- Redact body search as well, so anonymous queries cannot infer words behind the login gate.
    definition:=replace(definition,'post.body','case when auth.uid() is null then '''' else post.body end');
    definition:=replace(definition,'post.image_paths',
      'case when auth.uid() is null then case when split_part(post.image_paths[1],''/'',1)=post.author_id::text then post.image_paths[1:1] else ''{}''::text[] end else post.image_paths end');
    definition:=replace(definition,'post.room_preview',
      'case when auth.uid() is null and post.room_preview is not null then (select coalesce(jsonb_object_agg(field.key,field.value),''{}''::jsonb) from jsonb_each(post.room_preview) field where field.key=any(array[''memberCount'',''capacity'',''verifiedOnly'',''closed'',''eventKind'',''category'',''startsAt'',''endsAt'',''timezone'',''cadence'',''recommendedAgeMin'',''recommendedAgeMax''])) else post.room_preview end');
    execute definition;
  end loop;

  definition:=pg_get_functiondef('private.can_view_comment(uuid)'::regprocedure);
  anchor:='select private.comment_visible_to(p_comment_id, auth.uid());';
  if strpos(definition,anchor)=0 then raise exception 'caller comment visibility anchor missing'; end if;
  execute replace(definition,anchor,'select auth.uid() is not null and private.comment_visible_to(p_comment_id, auth.uid());');

  definition:=pg_get_functiondef('public.is_public_post_image(text)'::regprocedure);
  anchor:='post.image_paths @> array[image_path]';
  if strpos(definition,anchor)=0 then anchor:='p.image_paths @> array[image_path]'; end if;
  if strpos(definition,anchor)=0 then raise exception 'anonymous image visibility anchor missing'; end if;
  execute replace(definition,anchor,replace(anchor,' @> array[image_path]','[1] = image_path'));
end;
$$;

revoke all on function public.get_public_comments(uuid[]),
  public.get_public_comments_page(uuid,timestamptz,uuid,integer),
  public.get_comment_thread_page(uuid,uuid,timestamptz,uuid,integer),
  public.get_comment_thread_context(uuid,uuid) from public,anon;
notify pgrst,'reload schema';
