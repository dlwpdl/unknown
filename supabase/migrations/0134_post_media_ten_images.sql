-- Match the common ten-photo client cap, keeping ownership, safety and grants intact.
do $$
declare signature text; anchor text; replacement text; definition text;
begin
  for signature,anchor,replacement in select * from (values
    ('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)',
     '> (case when is_listing then 8 else 6 end)', '> 10'),
    ('private.assert_merchant_image_paths(text[],text[])', 'cardinality(paths)>6', 'cardinality(paths)>10')
  ) changes(signature,anchor,replacement) loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition,anchor)=0 then raise exception 'photo cap anchor missing: %',signature; end if;
    execute replace(definition,anchor,replacement);
    if strpos(pg_get_functiondef(signature::regprocedure),replacement)=0 then
      raise exception 'ten photo cap was not applied: %',signature;
    end if;
  end loop;
end;
$$;

alter table public.posts drop constraint posts_image_paths_check;
alter table public.posts add constraint posts_image_paths_check check (cardinality(image_paths) <= 10);
