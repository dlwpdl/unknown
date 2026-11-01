-- Owner 2026-10-26 / 2026-11-01: guests and crawlers may read about the first 150 characters of every public post
-- (plus one cover photo). Posts written from 2026-10-30 keep the longer opening paragraph (20261030121000);
-- older posts showed only their first line (median 40 characters) since 20261030160000. The rest stays login-gated,
-- meetups never expose a body, and the same contact/link/HTML line filters apply (private.public_post_preview).
create or replace function private.public_post_opening(p_body text, p_title text) returns text
language sql immutable set search_path='' as $$
  select case when char_length(preview)>150 then left(preview,149)||'…' else preview end
  from (select private.public_post_preview(p_body,p_title) as preview) as opening;
$$;
revoke all on function private.public_post_opening(text,text) from public,anon,authenticated,service_role;
alter function private.public_post_opening(text,text) owner to postgres;

do $migration$
declare
  definition text := pg_get_functiondef('public.get_shared_link_preview(uuid)'::regprocedure);
  anchor text := ' and p.created_at>=timestamptz ''2026-10-30 00:00 America/Vancouver'' then private.public_post_preview(p.body,p.title) end';
begin
  -- Literal count: the anchor has parentheses, so it is not used as a regular expression.
  if (char_length(definition) - char_length(replace(definition, anchor, ''))) / char_length(anchor) <> 1
    or position('private.public_post_opening' in definition) > 0 then
    raise exception 'shared preview projection changed; review before widening';
  end if;
  execute replace(definition, anchor,
    ' then case when p.created_at>=timestamptz ''2026-10-30 00:00 America/Vancouver'' then private.public_post_preview(p.body,p.title) else private.public_post_opening(p.body,p.title) end end');
end $migration$;
notify pgrst, 'reload schema';
