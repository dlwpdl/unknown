-- Owner 2026-11-12 (search check, 미리보기 길이 = "비즈니스·에디터 글만 전체"): guests and crawlers read the whole body of
-- official business posts and of the 글링 에디터 account's posts. Every other post keeps its 300- or 150-character opening.
-- The whole body still goes through the opening's contact/link/HTML line filters (a business post can carry a personal
-- phone or email line), stops at 2,000 characters (new posts are capped at 1,000) and meetups still show no body.
-- 'previewFull' tells the web build that the preview is the post's whole public body (job posting markup needs that).
-- The editor account id is already public (feed rows carry author_id).
-- shortcut: one editor account by id; if Gling runs more, mark them in app_metadata like gling_persona.

-- The opening's filter with the 300-character stop lifted: copy the live definition and change only its limits.
do $migration$
declare
  definition text := pg_get_functiondef('private.public_post_preview(text,text)'::regprocedure);
  edit text[];
begin
  if to_regprocedure('private.public_post_full(text,text)') is not null then
    raise exception 'private.public_post_full already exists; review before replacing it';
  end if;
  -- Lines are read up to 4,000 characters so a cut body always ends in '…' at 2,000.
  foreach edit slice 1 in array array[
    ['private.public_post_preview(', 'private.public_post_full('],
    ['where before<300', 'where before<4000'],
    ['char_length(joined)>500 then left(joined,499)', 'char_length(joined)>2000 then left(joined,1999)']] loop
    if (char_length(definition) - char_length(replace(definition, edit[1], ''))) / char_length(edit[1]) <> 1 then
      raise exception 'public preview filter changed (%); review before copying it', edit[1];
    end if;
    definition := replace(definition, edit[1], edit[2]);
  end loop;
  execute definition;
end $migration$;
revoke all on function private.public_post_full(text,text) from public,anon,authenticated,service_role;
alter function private.public_post_full(text,text) owner to postgres;

-- Append one override after the share preview's object, so the fields of every other post stay exactly as they are.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_shared_link_preview(uuid)'::regprocedure);
  anchor constant text := '''closed'',p.room_preview is not null and not private.meetup_is_open(p.status,p.room_preview))';
begin
  if (char_length(definition) - char_length(replace(definition, anchor, ''))) / char_length(anchor) <> 1
    or position('from private.business_public_posts p join public.profiles a on a.id=p.author_id' in definition) = 0
    or position('''previewFull''' in definition) > 0 then
    raise exception 'shared preview projection changed; review before widening';
  end if;
  execute replace(definition, anchor, anchor||$projection$
    ||case when p.room_preview is null and t.kind<>'meetup'
        and (p.business_author_id is not null or p.author_id='c55f864e-ff96-40d1-93a3-39b9ef5ce939'::uuid)
      then jsonb_build_object('preview',private.public_post_full(p.body,p.title),'previewFull',char_length(p.body)<=2000)
      else '{}'::jsonb end$projection$);
end $migration$;
notify pgrst, 'reload schema';
