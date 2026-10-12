-- Raise the shared photo cap without replacing current safety, ownership or permission guards.
do $$
declare signature text; anchor text; replacement text; definition text;
begin
  for signature,anchor,replacement in select * from (values
    ('private.create_merchant_content_post(text,smallint,text,text,text[],text[],jsonb,text,numeric,text[])',
     'coalesce(cardinality(p_image_paths), 0) > 10', 'coalesce(cardinality(p_image_paths), 0) > 20'),
    ('private.assert_merchant_image_paths(text[],text[])', 'cardinality(paths)>10', 'cardinality(paths)>20')
  ) changes(signature,anchor,replacement) loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition,anchor)=0 then raise exception 'photo cap anchor missing: %',signature; end if;
    execute replace(definition,anchor,replacement);
    if strpos(pg_get_functiondef(signature::regprocedure),replacement)=0 then
      raise exception 'twenty photo cap was not applied: %',signature;
    end if;
  end loop;
end;
$$;

alter table public.posts drop constraint posts_image_paths_check;
alter table public.posts add constraint posts_image_paths_check check (cardinality(image_paths) <= 20);
