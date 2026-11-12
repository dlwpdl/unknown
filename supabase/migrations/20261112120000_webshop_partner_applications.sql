-- 웹샵 제휴 신청 (owner 2026-11-12): the /business form and the place screen's "이 가게 사장님이세요?" row send one application.
-- The public webshop-apply function writes it with the service role; administrators read it and change its status through the
-- same AAL2 check as the webshop admin. Nobody reads or writes these tables directly.
create table private.webshop_applications (
  id uuid primary key default gen_random_uuid(),
  -- A place picked from the map catalog; both are empty when the owner typed the business name ('목록에 없어요').
  place_key text check(place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$'),
  city_id text references public.cities(id),
  place_name text not null check(length(btrim(place_name)) between 1 and 200 and place_name !~ '[[:cntrl:]]'),
  applicant_name text not null check(length(btrim(applicant_name)) between 1 and 100 and applicant_name !~ '[[:cntrl:]]'),
  -- One field: a phone number or a KakaoTalk ID, whichever the owner prefers.
  contact text not null check(length(btrim(contact)) between 1 and 100 and contact !~ '[[:cntrl:]]'),
  email text check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  has_webshop text not null check(has_webshop in ('yes','no','unknown')),
  webshop_url text check(length(webshop_url)<=2048 and webshop_url ~ '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'),
  discount text not null check(discount in ('5','10','15_plus','unknown')),
  source text not null check(source in ('place','web')),
  status text not null default 'new' check(status in ('new','contacted','done')),
  email_status text not null default 'pending' check(email_status in ('pending','sent','failed','not_configured')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((place_key is null)=(city_id is null)),
  check(webshop_url is null or has_webshop='yes')
);
create index webshop_applications_created on private.webshop_applications(created_at desc);
-- Only a salted hash of the caller's address, kept for one hour; null when the edge saw no address.
create table private.webshop_application_attempts (
  ip_sha256 text check(ip_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index webshop_application_attempts_ip on private.webshop_application_attempts(ip_sha256,created_at);
do $$ declare name text; begin
  foreach name in array array['webshop_applications','webshop_application_attempts'] loop
    execute format('alter table private.%I owner to postgres',name);
    execute format('alter table private.%I enable row level security',name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',name);
  end loop;
end $$;

-- Input problems return {ok:false} instead of raising, so the attempt row (the rate limit) is kept.
create function public.submit_webshop_application(p_application jsonb,p_ip_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb:=p_application; saved uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_ip_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_WEBSHOP_APPLICATION'; end if;
  -- One lock for every caller, so parallel requests cannot slip past the site-wide or per-address hourly cap.
  perform pg_advisory_xact_lock(hashtextextended('webshop_application',0));
  delete from private.webshop_application_attempts where created_at<clock_timestamp()-interval '1 hour';
  if (select count(*) from private.webshop_application_attempts)>=60
    or (select count(*) from private.webshop_application_attempts where ip_sha256=p_ip_sha256)>=5 then
    return jsonb_build_object('ok',false,'error','rate_limited');
  end if;
  insert into private.webshop_application_attempts(ip_sha256) values(p_ip_sha256);
  if jsonb_typeof(a) is distinct from 'object'
    or a-array['placeKey','cityId','placeName','name','contact','email','webshop','webshopUrl','discount','source']<>'{}'::jsonb then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  begin
    insert into private.webshop_applications(place_key,city_id,place_name,applicant_name,contact,email,has_webshop,webshop_url,discount,source)
      values(a->>'placeKey',a->>'cityId',btrim(a->>'placeName'),btrim(a->>'name'),btrim(a->>'contact'),nullif(btrim(a->>'email'),''),
        a->>'webshop',nullif(btrim(a->>'webshopUrl'),''),a->>'discount',a->>'source')
      returning id into saved;
  exception when check_violation or not_null_violation or foreign_key_violation or string_data_right_truncation then
    return jsonb_build_object('ok',false,'error','invalid');
  end;
  return jsonb_build_object('ok',true,'id',saved);
end $$;

-- The function records whether the admin mail went out; a sent or failed mail is never changed again.
create function public.set_webshop_application_email(p_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_id is null or coalesce(p_status not in ('sent','failed','not_configured'),true) then raise exception 'INVALID_WEBSHOP_APPLICATION'; end if;
  update private.webshop_applications set email_status=p_status where id=p_id and email_status='pending';
end $$;

create function public.get_admin_webshop_applications() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.lock_partnership_actor();
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'placeKey',a.place_key,'cityId',a.city_id,'placeName',a.place_name,
      'name',a.applicant_name,'contact',a.contact,'email',a.email,'webshop',a.has_webshop,'webshopUrl',a.webshop_url,
      'discount',a.discount,'source',a.source,'status',a.status,'emailStatus',a.email_status,'createdAt',a.created_at,'updatedAt',a.updated_at)
      order by a.created_at desc,a.id),'[]'::jsonb) into result
    from (select * from private.webshop_applications order by created_at desc,id limit 500) a;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,null);
  return result;
end $$;

create function public.set_admin_webshop_application_status(p_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved private.webshop_applications;
begin
  perform private.lock_partnership_actor();
  if p_id is null or coalesce(p_status not in ('new','contacted','done'),true) then raise exception 'INVALID_WEBSHOP_APPLICATION'; end if;
  update private.webshop_applications set status=p_status,updated_at=clock_timestamp() where id=p_id returning * into saved;
  if saved.id is null then raise exception 'WEBSHOP_APPLICATION_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_id);
  return jsonb_build_object('id',saved.id,'status',saved.status,'updatedAt',saved.updated_at);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.submit_webshop_application(jsonb,text)','public.set_webshop_application_email(uuid,text)',
    'public.get_admin_webshop_applications()','public.set_admin_webshop_application_status(uuid,text)'] loop
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
grant execute on function public.submit_webshop_application(jsonb,text),public.set_webshop_application_email(uuid,text) to service_role;
grant execute on function public.get_admin_webshop_applications(),public.set_admin_webshop_application_status(uuid,text) to authenticated;

-- The place screen row and the accepted application (split by where the owner came from) on the new public 'business' screen.
insert into private.behavior_targets(id) values
('places.detail.owner_webshop'),('business.webshop.apply.place'),('business.webshop.apply.web')
on conflict do nothing;
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.record_behavior_events(text,text,jsonb)'::regprocedure);
  if strpos(definition,'''faq'',''visited''')=0 then raise exception 'BEHAVIOR_SCREEN_CHECK_CHANGED'; end if;
  execute replace(definition,'''faq'',''visited''','''faq'',''visited'',''business''');
end;
$$;
notify pgrst,'reload schema';
