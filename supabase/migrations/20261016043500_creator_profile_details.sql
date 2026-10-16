-- Keep existing creator identities and private admin access while enriching their profiles.
create function private.valid_creator_platforms(p_platforms jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; canonical text; seen text[]:='{}';
begin
  if p_platforms is null or jsonb_typeof(p_platforms)<>'array' then return false; end if;
  if jsonb_array_length(p_platforms)>20 then return false; end if;
  for item in select value from jsonb_array_elements(p_platforms) loop
    if jsonb_typeof(item) is distinct from 'object'
      or item-array['platform','url','followers','checked_on']<>'{}'::jsonb
      or jsonb_typeof(item->'platform') is distinct from 'string'
      or length(item->>'platform') not between 1 and 40 or btrim(item->>'platform')=''
      or jsonb_typeof(item->'url') is distinct from 'string' then return false; end if;
    canonical:=private.partnership_profile_key(item->>'url');
    if canonical is null or canonical=any(seen) then return false; end if;
    seen:=array_append(seen,canonical);
    if item ? 'followers' and (jsonb_typeof(item->'followers') is distinct from 'string'
      or length(item->>'followers')>80) then return false; end if;
    if item ? 'checked_on' and item->'checked_on'<>'null'::jsonb then
      if jsonb_typeof(item->'checked_on') is distinct from 'string'
        or (item->>'checked_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
      perform (item->>'checked_on')::date;
    end if;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
alter function private.valid_creator_platforms(jsonb) owner to postgres;
revoke all on function private.valid_creator_platforms(jsonb) from public,anon,authenticated,service_role;

alter table private.partnership_creators
  add column platforms jsonb not null default '[]' check(private.valid_creator_platforms(platforms)),
  add column contact_name text not null default '' check(length(contact_name)<=120),
  add column content_summary text not null default '' check(length(content_summary)<=2000),
  add column activity_regions text not null default '' check(length(activity_regions)<=500);

-- Fail closed if another migration changed these exact creator-only anchors.
do $patches$
declare patch record; definition text;
begin
  for patch in select * from (values
    ('public.save_admin_partnership(text,jsonb,timestamp with time zone)',
      $old$when 'creator' then array['id','member_id','display_name','city_id','profile_url','category','contact','reference_url','reference_views','metrics_note','status','notes']$old$,
      $new$when 'creator' then array['id','member_id','display_name','city_id','profile_url','category','contact','reference_url','reference_views','metrics_note','status','notes','platforms','contact_name','content_summary','activity_regions']$new$),
    ('public.save_admin_partnership(text,jsonb,timestamp with time zone)',
      $old$elsif field.key in ('terms_confirmed') then$old$,
      $new$elsif field.key='platforms' then
      if not private.valid_creator_platforms(field.value) then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif field.key in ('terms_confirmed') then$new$),
    ('public.save_admin_partnership(text,jsonb,timestamp with time zone)',
      $old$'{"category":"","contact":"","reference_url":"","metrics_note":"","status":"active","notes":""}'::jsonb||data$old$,
      $new$'{"category":"","contact":"","reference_url":"","metrics_note":"","status":"active","notes":"","platforms":[],"contact_name":"","content_summary":"","activity_regions":""}'::jsonb||data$new$),
    ('public.save_admin_partnership(text,jsonb,timestamp with time zone)',
      $old$insert into private.partnership_creators(id,member_id,display_name,city_id,profile_url,category,contact,reference_url,reference_views,metrics_note,status,notes,created_at,updated_at)$old$,
      $new$insert into private.partnership_creators(id,member_id,display_name,city_id,profile_url,category,contact,reference_url,reference_views,metrics_note,status,notes,platforms,contact_name,content_summary,activity_regions,created_at,updated_at)$new$),
    ('public.save_admin_partnership(text,jsonb,timestamp with time zone)',
      $old$values(rid,r.member_id,btrim(r.display_name),r.city_id,r.profile_url,r.category,r.contact,r.reference_url,r.reference_views,r.metrics_note,r.status,r.notes,coalesce((old->>'created_at')::timestamptz,stamp),stamp)$old$,
      $new$values(rid,r.member_id,btrim(r.display_name),r.city_id,r.profile_url,r.category,r.contact,r.reference_url,r.reference_views,r.metrics_note,r.status,r.notes,r.platforms,r.contact_name,r.content_summary,r.activity_regions,coalesce((old->>'created_at')::timestamptz,stamp),stamp)$new$),
    ('public.save_admin_partnership(text,jsonb,timestamp with time zone)',
      $old$metrics_note=excluded.metrics_note,status=excluded.status,notes=excluded.notes,updated_at=excluded.updated_at;$old$,
      $new$metrics_note=excluded.metrics_note,status=excluded.status,notes=excluded.notes,platforms=excluded.platforms,
        contact_name=excluded.contact_name,content_summary=excluded.content_summary,activity_regions=excluded.activity_regions,updated_at=excluded.updated_at;$new$),
    ('public.get_admin_partnerships(text,text,integer,uuid,integer)',
      $old$concat_ws(' ',r.display_name,p.nickname,city.name,r.city_id,r.profile_url,r.category)$old$,
      $new$concat_ws(' ',r.display_name,p.nickname,city.name,r.city_id,r.profile_url,r.category,r.contact_name,r.contact,r.content_summary,r.activity_regions,r.platforms::text)$new$)
  ) p(signature,anchor,replacement) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    if array_length(string_to_array(definition,patch.anchor),1)<>2 then
      raise exception 'CREATOR_PROFILE_ANCHOR_CHANGED: %',patch.signature;
    end if;
    execute replace(definition,patch.anchor,patch.replacement);
  end loop;
end;
$patches$;
notify pgrst,'reload schema';
