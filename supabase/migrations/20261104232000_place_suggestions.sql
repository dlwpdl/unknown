-- 회원이 가져오기로 넣었지만 글링 지도에 없는 가게 이름을 '글링 장소 후보'로 모은다 (owner 2026-11-04
-- "만약 없는위치면 우리가 확인할수잇게", "우리는 유저의 힘을 빌리는거지"). 이름만 받는다(구글 좌표·평점·사진 없음).
-- 장소 찾기 자동화가 공식 자료로 확인해 지도에 넣으면 resolve가 후보를 낸 회원의 저장에 넣고 알림을 하나 보낸다.
create table private.place_suggestions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 city_id text not null references public.cities(id),
 name text not null check(name=btrim(name) and char_length(name) between 1 and 120 and name !~ '[[:cntrl:]]'),
 source text not null check(source in ('text','google-list','takeout','instagram','tiktok','manual')),
 status text not null default 'pending' check(status in ('pending','added','rejected')),
 place_key text check(place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$'),
 note text check(char_length(note)<=300),
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 check((status='pending')=(resolved_at is null)),
 check(status<>'added' or place_key is not null)
);
create unique index place_suggestions_pending_once on private.place_suggestions(user_id,city_id,lower(name)) where status='pending';
create index place_suggestions_pending_city on private.place_suggestions(city_id,lower(name)) where status='pending';
alter table private.place_suggestions enable row level security;
revoke all on private.place_suggestions from public,anon,authenticated,service_role;
alter table private.place_suggestions owner to postgres;

-- The member's own reply ("your place is saved"): 'system' so it is never throttled as a recommendation.
-- target_id is the member's suggestion row, so every row is one notification at most.
do $$
declare definition text;
begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
 if definition is null or definition not like 'CHECK (%' or definition like '%place_suggestion_added%' then raise exception 'PLACE_SUGGESTION_KIND_CHANGED'; end if;
 alter table public.notifications drop constraint notifications_kind_check;
 execute 'alter table public.notifications add constraint notifications_kind_check '||
  replace(definition,'CHECK (','CHECK (kind = ''place_suggestion_added'' or ');
 select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid='public.notifications'::regclass and conname='notifications_target_type_check';
 if definition is null or definition not like 'CHECK (%' or definition like '%place_suggestion%' then raise exception 'PLACE_SUGGESTION_TARGET_CHANGED'; end if;
 alter table public.notifications drop constraint notifications_target_type_check;
 execute 'alter table public.notifications add constraint notifications_target_type_check '||
  replace(definition,'CHECK (','CHECK (target_type = ''place_suggestion'' or ');
 definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
 if array_length(string_to_array(definition,'case p_kind'),1)<>2 then raise exception 'PLACE_SUGGESTION_CATEGORY_CHANGED'; end if;
 execute replace(definition,'case p_kind','case p_kind when ''place_suggestion_added'' then ''system''');
end $$;

create function public.suggest_places(p_city_id text,p_names text[],p_source text) returns integer
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); added integer;
begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if;
 perform private.assert_active_account(uid);
 if p_city_id is null or p_city_id !~ '^[a-z][a-z0-9-]{0,63}$' or not exists(select 1 from public.cities c where c.id=p_city_id)
  or p_source is null or p_source not in ('text','google-list','takeout','instagram','tiktok','manual')
  or p_names is null or cardinality(p_names)>200 then raise exception 'INVALID_PLACE_SUGGESTION'; end if;
 perform private.enforce_rate_limit('place_suggestions', 20, interval '1 day');
 -- Invalid names (blank, over 120 characters, control characters) are skipped; the count says what went in.
 insert into private.place_suggestions(user_id,city_id,name,source)
 select distinct on (lower(s.n)) uid,p_city_id,s.n,p_source
  from (select btrim(regexp_replace(v,'[[:space:]]+',' ','g')) n from unnest(p_names) v) s
  where char_length(s.n) between 1 and 120 and s.n !~ '[[:cntrl:]]'
  order by lower(s.n),s.n
 on conflict (user_id,city_id,lower(name)) where status='pending' do nothing;
 get diagnostics added=row_count;
 return added;
end $$;

-- Member ids never leave: one row per name with how many members suggested it.
create function public.list_place_suggestions(p_city_id text,p_limit integer default 50)
returns table(name text,members integer,first_at timestamptz,last_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 if p_city_id is null or p_city_id !~ '^[a-z][a-z0-9-]{0,63}$' or p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_PLACE_SUGGESTION'; end if;
 return query select mode() within group (order by s.name),count(*)::integer,min(s.created_at),max(s.created_at)
  from private.place_suggestions s where s.city_id=p_city_id and s.status='pending' and private.is_active_account(s.user_id)
  group by lower(s.name) order by count(*) desc,min(s.created_at),lower(s.name) limit p_limit;
end $$;

create function public.resolve_place_suggestions(p_city_id text,p_name text,p_status text,p_place_key text default null,p_note text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare claims text:=current_setting('request.jwt.claims',true); wanted text:=lower(btrim(regexp_replace(p_name,'[[:space:]]+',' ','g')));
 v_card jsonb; v_body text; v_route text; item record; saved boolean; changed integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 if p_city_id is null or p_city_id !~ '^[a-z][a-z0-9-]{0,63}$' or wanted is null or char_length(wanted) not between 1 and 120
  or p_status is null or p_status not in ('added','rejected') or (p_status='added')<>(p_place_key is not null)
  or char_length(p_note)>300 then raise exception 'INVALID_PLACE_SUGGESTION'; end if;
 if p_status='added' then
  -- The same checks set_saved_item uses: key format, then the place is on the map and saveable right now.
  perform private.saved_validate('place',p_place_key,p_city_id);
  v_card:=private.saved_card(private.saved_ref('place',p_place_key,p_city_id));
  if v_card is null then raise exception 'PLACE_UNAVAILABLE'; end if;
  -- English copy: place_suggestion_added in src/lib/notification-copy.ts.
  v_body:='요청하신 ‘'||(v_card->>'title')||'’, 글링 지도에 올리고 저장해 뒀어요.';
  -- The place screen opens a linked business on its own.
  v_route:='/places/'||p_place_key||'?cityId='||p_city_id;
 end if;
 for item in update private.place_suggestions set status=p_status,place_key=p_place_key,note=p_note,resolved_at=clock_timestamp()
   where city_id=p_city_id and lower(name)=wanted and status='pending' returning id,user_id
 loop
  changed:=changed+1;
  continue when p_status<>'added' or not private.is_active_account(item.user_id);
  -- Save as the member so set_saved_item keeps its lock and checks (precedent: 20261029140000_host_loyalty).
  perform set_config('request.jwt.claims',jsonb_build_object('sub',item.user_id,'role','authenticated')::text,true);
  begin
   perform public.set_saved_item('place',p_place_key,true,p_city_id);
   saved:=true;
  exception when raise_exception then
   -- e.g. the member blocked the linked business; everyone else still gets it.
   if sqlerrm<>'SAVED_TARGET_UNAVAILABLE' then raise; end if;
   saved:=false;
  end;
  perform set_config('request.jwt.claims',coalesce(claims,''),true);
  continue when not saved or exists(select 1 from public.notifications n
   where n.user_id=item.user_id and n.kind='place_suggestion_added' and n.route=v_route);
  perform private.create_notification(item.user_id,'place_suggestion_added',null,'place_suggestion',item.id,v_body,v_route);
 end loop;
 return changed;
end $$;

do $$ declare signature text; begin
 foreach signature in array array['public.suggest_places(text,text[],text)','public.list_place_suggestions(text,integer)',
  'public.resolve_place_suggestions(text,text,text,text,text)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.suggest_places(text,text[],text) to authenticated;
grant execute on function public.list_place_suggestions(text,integer),public.resolve_place_suggestions(text,text,text,text,text) to service_role;
notify pgrst,'reload schema';
