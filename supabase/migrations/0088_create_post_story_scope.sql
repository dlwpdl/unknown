-- 0088 (0085 collided with the admin_trust_level_scope migration): 0066 appended an unqualified room_preview
-- to the story quota query, which collides with create_post's
-- local variable of the same name. Every story post therefore raised "column reference room_preview is
-- ambiguous" instead of being created. Qualify the column.
do $$
declare definition text; anchor text := 'and kind = ''story'' and room_preview is null;';
begin
  definition := pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure);
  if strpos(definition, anchor) = 0 then raise exception 'story quota anchor missing'; end if;
  execute replace(definition, anchor, 'and kind = ''story'' and public.posts.room_preview is null;');
end;
$$;
