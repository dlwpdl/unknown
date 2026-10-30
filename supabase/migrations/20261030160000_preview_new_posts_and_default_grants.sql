-- Owner 2026-10-30 (security review): the public opening-paragraph preview covers only posts written from
-- 2026-10-30 on, since older posts were written when bodies were members-only. New public functions no longer
-- become executable by anon by default; every anon-callable function keeps its explicit grant.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_shared_link_preview(uuid)'::regprocedure);
  anchor text := '''preview'',case when p.room_preview is null and t.kind<>''meetup'' then';
begin
  if (select count(*) from regexp_matches(definition, anchor, 'g')) <> 1 then
    raise exception 'shared preview projection changed; review before narrowing';
  end if;
  execute replace(definition, anchor,
    '''preview'',case when p.room_preview is null and t.kind<>''meetup'' and p.created_at>=timestamptz ''2026-10-30 00:00 America/Vancouver'' then');
end $migration$;

alter default privileges for role postgres in schema public revoke execute on functions from anon;
notify pgrst, 'reload schema';
