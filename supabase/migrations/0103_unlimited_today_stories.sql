-- Today stories are free at every tier. Keep a short spam guard; meetup hosting,
-- live listings and direct conversations retain their existing limits.
do $$
declare
  definition text;
  old_branch text := E'  elsif tag_kind<>''meetup'' then\n    select count(*) into used_count\n    from public.posts\n    where author_id = current_user_id and posted_on = usage_day and kind = ''story'' and public.posts.room_preview is null;\n    if not private.is_admin_id(current_user_id) and used_count >= daily_limit then raise exception ''DAILY_POST_LIMIT_REACHED''; end if;';
  new_branch text := E'  elsif tag_kind<>''meetup'' then\n    perform private.enforce_rate_limit(''story_post'', 10, interval ''10 minutes'');\n    if exists (\n      select 1 from public.posts existing\n      where existing.author_id = current_user_id and existing.kind = ''story''\n        and existing.room_preview is null and existing.status = ''published''\n        and existing.created_at > now() - interval ''10 minutes''\n        and lower(trim(existing.title)) = lower(trim(p_title))\n        and lower(trim(existing.body)) = lower(trim(p_body))\n    ) then raise exception ''DUPLICATE_POST''; end if;';
begin
  definition := pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure);
  if strpos(definition, old_branch) = 0 then raise exception 'story quota branch changed; review before applying'; end if;
  execute replace(definition, old_branch, new_branch);
end;
$$;
