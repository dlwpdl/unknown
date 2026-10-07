-- 0095 (0089 was taken by admin_count_deltas): a post may carry up to five photos. Listings keep eight.
-- The client already compresses each photo to 1280px webp (target 700KB) and uploads a 480px thumbnail beside it.
alter table public.posts drop constraint posts_image_paths_check;
alter table public.posts add constraint posts_image_paths_check check (cardinality(image_paths) <= 8);

do $$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure);
  anchor := '> (case when is_listing then 8 else 4 end)';
  if strpos(definition, anchor) = 0 then raise exception 'post image cap anchor missing'; end if;
  -- 목록은 8장, 그 외 글은 5장. 상한은 표의 CHECK와 같은 값이어야 한다.
  execute replace(definition, anchor, '> (case when is_listing then 8 else 5 end)');
end;
$$;
