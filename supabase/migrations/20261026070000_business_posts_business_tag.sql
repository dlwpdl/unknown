-- A business publishing as itself lands in 비즈니스 (or 구인구직 for listings), like the app's business writer (owner 2026-10-26).
-- Drafts published on a business's behalf by someone else keep their chosen topic.
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.publish_merchant_workspace_draft(uuid,uuid,timestamp with time zone)'::regprocedure);
  if strpos(d,'select id into tag from public.tags where slug=d.tag_slug and kind=''post'';')=0 then raise exception 'publish tag anchor missing'; end if;
  d:=replace(d,'select id into tag from public.tags where slug=d.tag_slug and kind=''post'';',
    'select id into tag from public.tags where kind=''post'' and slug=case when m.record_kind=''business'' and (coalesce(auth.uid()=m.owner_id,false) or exists(select 1 from private.merchant_operators where merchant_id=m.id and user_id=auth.uid())) then case d.kind when ''listing'' then ''jobs'' else ''business'' end else d.tag_slug end;');
  execute d;
end;
$$;
