-- Match the six-card festival template. Listings retain their existing eight-photo cap.
do $$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure);
  anchor := '> (case when is_listing then 8 else 5 end)';
  if strpos(definition, anchor) = 0 then raise exception 'post image cap anchor missing'; end if;
  execute replace(definition, anchor, '> (case when is_listing then 8 else 6 end)');
  if strpos(pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure),
            '> (case when is_listing then 8 else 6 end)') = 0 then
    raise exception 'six photo cap was not applied';
  end if;
end;
$$;
