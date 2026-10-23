-- Bookmarks remain private. Existing post/merchant saves remain authoritative.
create table private.saved_places (
 user_id uuid not null references public.profiles(id) on delete cascade,
 city_id text not null references public.cities(id),
 place_key text not null check(place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$'),
 created_at timestamptz not null default clock_timestamp(), primary key(user_id,city_id,place_key)
);
create index saved_places_page on private.saved_places(user_id,created_at desc,city_id,place_key);
create table private.saved_users (
 user_id uuid not null references public.profiles(id) on delete cascade,
 target_user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), primary key(user_id,target_user_id), check(user_id<>target_user_id)
);
create index saved_users_page on private.saved_users(user_id,created_at desc,target_user_id desc);
create index saved_users_target on private.saved_users(target_user_id);
create index saved_post_page on public.post_reactions(user_id,created_at desc,post_id desc) where kind='save';
create table private.saved_folders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(name=btrim(name) and char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp(), unique(user_id,id)
);
create table private.saved_folder_items (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, folder_id uuid not null,
 post_id uuid, post_kind text not null default 'save' check(post_kind='save'), merchant_id uuid,
 person_id uuid, place_city_id text, place_key text,
 check(num_nonnulls(post_id,merchant_id,person_id,place_key)=1), check((place_city_id is null)=(place_key is null)),
 foreign key(user_id,folder_id) references private.saved_folders(user_id,id) on delete cascade,
 foreign key(post_id,user_id,post_kind) references public.post_reactions(post_id,user_id,kind) on delete cascade,
 foreign key(user_id,merchant_id) references private.saved_merchants(user_id,merchant_id) on delete cascade,
 foreign key(user_id,person_id) references private.saved_users(user_id,target_user_id) on delete cascade,
 foreign key(user_id,place_city_id,place_key) references private.saved_places(user_id,city_id,place_key) on delete cascade
);
create index saved_folder_items_owner on private.saved_folder_items(user_id,folder_id);
create unique index saved_folder_post on private.saved_folder_items(folder_id,post_id) where post_id is not null;
create unique index saved_folder_merchant on private.saved_folder_items(folder_id,merchant_id) where merchant_id is not null;
create unique index saved_folder_person on private.saved_folder_items(folder_id,person_id) where person_id is not null;
create unique index saved_folder_place on private.saved_folder_items(folder_id,place_city_id,place_key) where place_key is not null;

-- These are the two existing source-verified DELIVERY_PARTNERS, not client facts.
create table private.saved_partner_places (
 city_id text not null references public.cities(id), place_key text not null,
 name text not null, address text not null, primary key(city_id,place_key)
);
insert into private.saved_partner_places values
 ('vancouver','partner:jimoco-coquitlam','Jimoco Café & Pasta','1046A Austin Ave, Coquitlam, BC V3K 3P3'),
 ('vancouver','partner:on-and-off-coquitlam','On & Off Kitchen + Bar','2662 Austin Ave, Coquitlam, BC V3K 6C4');
do $$ declare t text; begin
 foreach t in array array['saved_places','saved_users','saved_folders','saved_folder_items','saved_partner_places'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('alter table private.%I owner to postgres',t);
 end loop;
end $$;

create function private.saved_validate(p_kind text,p_id text,p_city text) returns void
language plpgsql immutable set search_path='' as $$ begin
 if p_kind is null or p_kind not in ('post','merchant','place','user') or p_id is null
  or (p_kind<>'place' and p_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  or (p_kind='place' and (p_city is null or length(p_id)>120 or not(p_id ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or p_id ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$')))
  or (p_city is not null and p_city !~ '^[a-z][a-z0-9-]{0,63}$') then raise exception 'INVALID_SAVED_TARGET'; end if;
end $$;
create function private.saved_owner(p_lock boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$ declare uid uuid:=auth.uid(); begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_lock then perform pg_advisory_xact_lock(hashtextextended(uid::text||':saved-library',2322)); end if;
 perform private.assert_active_account(uid);
 return uid;
end $$;
create function private.saved_ref(p_kind text,p_id text,p_city text) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare mid uuid; city text; begin
 if p_kind='place' then
  select l.merchant_id,l.city_id into mid,city from private.webshop_place_links l
   join private.merchants m on m.id=l.merchant_id and m.city_id=l.city_id where l.place_key=p_id and l.city_id=p_city;
  if mid is not null then return jsonb_build_object('kind','merchant','id',mid,'cityId',city); end if;
  return jsonb_build_object('kind','place','id',p_id,'cityId',p_city);
 end if;
 if p_kind='merchant' then select city_id into city from private.merchants where id=p_id::uuid;
 elsif p_kind='post' then select city_id into city from public.posts where id=p_id::uuid;
 else select city_id into city from public.profiles where id=p_id::uuid; end if;
 return jsonb_strip_nulls(jsonb_build_object('kind',p_kind,'id',lower(p_id),'cityId',city));
end $$;
create function private.saved_key(p_target jsonb) returns text
language sql immutable set search_path='' as $$
 select (p_target->>'kind')||':'||coalesce((p_target->>'cityId')||':','')||(p_target->>'id')
$$;
create function private.saved_sources(p_uid uuid) returns table(kind text,id text,city text,saved_at timestamptz,target jsonb,key text)
language sql stable security definer set search_path='' as $$
 select s.*,r.target,private.saved_key(r.target) from (
  select 'post'::text kind,post_id::text id,null::text city,created_at saved_at from public.post_reactions where user_id=p_uid and kind='save'
  union all select 'merchant',merchant_id::text,null,created_at from private.saved_merchants where user_id=p_uid
  union all select 'place',place_key,city_id,created_at from private.saved_places where user_id=p_uid
  union all select 'user',target_user_id::text,null,created_at from private.saved_users where user_id=p_uid
 )s cross join lateral(select private.saved_ref(s.kind,s.id,s.city) target)r
$$;
create function private.saved_merchant_at(p_uid uuid,p_mid uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select max(created_at) from (
  select created_at from private.saved_merchants where user_id=p_uid and merchant_id=p_mid
  union all select s.created_at from private.saved_places s join private.webshop_place_links l on l.place_key=s.place_key and l.city_id=s.city_id
   join private.merchants m on m.id=l.merchant_id and m.city_id=l.city_id where s.user_id=p_uid and l.merchant_id=p_mid
 )s
$$;
-- Extend only the public wrapper; retain the optimized/private profile lookup.
do $$ declare definition text; anchor text:='||jsonb_build_object('; begin
 definition:=pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'SAVED_PROFILE_WRAPPER_CHANGED'; end if;
 execute replace(definition,anchor,anchor||'''saved'',private.is_active_account(auth.uid()) and private.saved_merchant_at(auth.uid(),p_merchant_id) is not null,');
end $$;

create function private.saved_place_info(p_city text,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare item jsonb; begin
 if exists(select 1 from private.webshop_place_links l join private.merchants m on m.id=l.merchant_id
  where l.place_key=p_key and (l.city_id<>p_city or m.city_id<>p_city)) then return null; end if;
 select p into item from private.city_place_catalog c cross join lateral jsonb_array_elements(coalesce(c.payload->'cities'->p_city->'places','[]'::jsonb)) p
  where p->>'id'=p_key and p->>'cityId'=p_city and p_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$'
  and p->>'category' in ('food','cafe','places') and jsonb_typeof(p->'name')='string' and length(btrim(p->>'name')) between 1 and 300
  and jsonb_typeof(p->'address')='string' and length(p->>'address')<=1000
  and case when jsonb_typeof(p->'latitude')='number' then (p->>'latitude')::numeric between 40 and 85 else false end
  and case when jsonb_typeof(p->'longitude')='number' then (p->>'longitude')::numeric between -142 and -52 else false end
  and p->>'sourceUrl'='https://www.openstreetmap.org/'||replace(substr(p_key,5),':','/') limit 1;
 if item is not null then return jsonb_build_object('name',item->>'name','address',coalesce(item->>'address','')); end if;
 select jsonb_build_object('name',name,'address',address) into item from private.saved_partner_places where city_id=p_city and place_key=p_key;
 return item;
end $$;
create function private.saved_card(p_target jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare k text:=p_target->>'kind'; item jsonb; city text:=p_target->>'cityId'; post_type text; is_closed boolean:=false; begin
 if k='post' then
  -- get_saved_posts has always excluded an inactive stored author as well.
  if not exists(select 1 from public.posts p join public.profiles author on author.id=p.author_id
   where p.id=(p_target->>'id')::uuid and author.account_status='active') then return null; end if;
  select to_jsonb(p) into item from public.get_public_post((p_target->>'id')::uuid)p limit 1;
  if item is null then return null; end if;
  post_type:=case when item->>'tag_slug'='jobs' then 'job' when item->'room_preview' is not null and item->'room_preview'<>'null'::jsonb then 'meetup' when item->>'kind'='listing' then 'listing' else 'post' end;
  is_closed:=coalesce(item->>'listing_status'='closed',false) or coalesce((item->'room_preview'->>'closed')::boolean,false)
   or (item->>'kind'='listing' and (item->>'expires_at')::timestamptz<=now());
  return jsonb_build_object('target',p_target,'title',item->>'title','subtitle',left(coalesce(item->>'body',''),3000),'cityId',city,'postType',post_type,'closed',coalesce(is_closed,false),
   '_searchText',coalesce(item->>'body','')||' '||coalesce((item->'hashtags')::text,''));
 elsif k='merchant' then
  item:=public.get_merchant_profile((p_target->>'id')::uuid); if item is null then return null; end if;
  return jsonb_build_object('target',p_target,'title',item->>'name','subtitle',coalesce(item->>'address',''),'address',item->>'address','cityId',city,
   'hasWebshop',exists(select 1 from private.webshops w where w.merchant_id=(p_target->>'id')::uuid and w.enabled and private.valid_webshop_url(w.url)));
 elsif k='user' then
  item:=public.get_public_user_profile((p_target->>'id')::uuid); if item is null then return null; end if;
  return jsonb_build_object('target',p_target,'title',item->>'nickname','subtitle',coalesce(item->>'neighborhood',''),'cityId',city);
 else
  item:=private.saved_place_info(city,p_target->>'id'); if item is null then return null; end if;
  return jsonb_build_object('target',p_target,'title',item->>'name','subtitle',item->>'address','address',item->>'address','cityId',city);
 end if;
end $$;
create function private.saved_member_source(p_member private.saved_folder_items) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_member.post_id is not null then private.saved_ref('post',p_member.post_id::text,null)
  when p_member.merchant_id is not null then private.saved_ref('merchant',p_member.merchant_id::text,null)
  when p_member.person_id is not null then private.saved_ref('user',p_member.person_id::text,null)
  else private.saved_ref('place',p_member.place_key,p_member.place_city_id) end
$$;
create function private.saved_group_folders(p_uid uuid,p_key text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from (
  select distinct f.folder_id id from private.saved_folder_items f where f.user_id=p_uid and private.saved_key(private.saved_member_source(f))=p_key
 )s
$$;
create function private.saved_state(p_uid uuid,p_kind text,p_id text,p_city text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ref jsonb:=private.saved_ref(p_kind,p_id,p_city); card jsonb; stamp timestamptz; folders jsonb; begin
 card:=private.saved_card(ref);
 select max(saved_at) into stamp from private.saved_sources(p_uid) where key=private.saved_key(ref);
 folders:=private.saved_group_folders(p_uid,private.saved_key(ref));
 return jsonb_build_object('target',case when card is not null then ref else jsonb_strip_nulls(jsonb_build_object('kind',p_kind,'id',p_id,'cityId',p_city)) end,
  'available',card is not null,'saved',stamp is not null,'savedAt',stamp,'folderIds',folders);
end $$;
create function public.get_saved_item_state(p_kind text,p_id text,p_city_id text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid; begin
 uid:=private.saved_owner(); perform private.saved_validate(p_kind,p_id,p_city_id);
 return private.saved_state(uid,p_kind,p_id,p_city_id);
end $$;
create function public.set_saved_item(p_kind text,p_id text,p_saved boolean,p_city_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; ref jsonb; sources jsonb; source jsonb; stamp timestamptz; begin
 uid:=private.saved_owner(true); perform private.saved_validate(p_kind,p_id,p_city_id);
 if p_saved is null then raise exception 'INVALID_SAVED_TARGET'; end if;
 ref:=private.saved_ref(p_kind,p_id,p_city_id);
 -- Resolve all backing aliases in one statement; later DELETEs use this captured set.
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb),max(saved_at) into sources,stamp
  from private.saved_sources(uid)s where key=private.saved_key(ref);
 if p_saved then
  if ref->>'kind'='merchant' then
   perform 1 from private.merchants where id=(ref->>'id')::uuid for share;
   perform 1 from private.merchant_posts mp join public.posts p on p.id=mp.post_id join public.profiles author on author.id=p.author_id
    where mp.merchant_id=(ref->>'id')::uuid for share of mp,p,author;
  end if;
  if private.saved_card(ref) is null or (p_kind='user' and p_id::uuid=uid) then raise exception 'SAVED_TARGET_UNAVAILABLE'; end if;
  if stamp is null then
   case ref->>'kind'
    when 'post' then insert into public.post_reactions(post_id,user_id,kind) values((ref->>'id')::uuid,uid,'save') on conflict do nothing;
    when 'merchant' then insert into private.saved_merchants(user_id,merchant_id) values(uid,(ref->>'id')::uuid) on conflict do nothing;
    when 'user' then insert into private.saved_users(user_id,target_user_id) values(uid,(ref->>'id')::uuid) on conflict do nothing;
    else insert into private.saved_places(user_id,city_id,place_key) values(uid,ref->>'cityId',ref->>'id') on conflict do nothing;
   end case;
  end if;
 else
  for source in select value from jsonb_array_elements(sources) loop
   case source->>'kind'
    when 'post' then delete from public.post_reactions where user_id=uid and post_id=(source->>'id')::uuid and kind='save';
    when 'merchant' then delete from private.saved_merchants where user_id=uid and merchant_id=(source->>'id')::uuid;
    when 'user' then delete from private.saved_users where user_id=uid and target_user_id=(source->>'id')::uuid;
    else delete from private.saved_places where user_id=uid and city_id=source->>'city' and place_key=source->>'id';
   end case;
  end loop;
 end if;
 return private.saved_state(uid,p_kind,p_id,p_city_id);
end $$;

create function public.get_saved_items(p_filter text default 'all',p_query text default '',p_folder_id uuid default null,
 p_before_saved_at timestamptz default null,p_before_key text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid; result jsonb; begin
 uid:=private.saved_owner();
 if p_filter is null or p_filter not in ('all','places','posts','jobs','users') or p_query is null or length(btrim(p_query))>120 then raise exception 'INVALID_SAVED_QUERY'; end if;
 if num_nonnulls(p_before_saved_at,p_before_key)=1 or (p_before_saved_at is not null and not isfinite(p_before_saved_at))
  or (p_before_key is not null and length(p_before_key) not between 1 and 240) then raise exception 'INVALID_SAVED_CURSOR'; end if;
 if p_folder_id is not null and not exists(select 1 from private.saved_folders where user_id=uid and id=p_folder_id) then raise exception 'FOLDER_UNAVAILABLE'; end if;
 with groups as materialized (
  select s.key,max(s.saved_at) saved_at,(jsonb_agg(s.target)->0) target from private.saved_sources(uid)s group by s.key
 ), cards as materialized (
  select g.*,private.saved_card(g.target) card,private.saved_group_folders(uid,g.key) folders from groups g
 ), page as materialized (
  select key,saved_at,(card-'_searchText')||jsonb_build_object('key',key,'savedAt',saved_at,'folderIds',folders) item from cards
  where card is not null
   and (p_filter='all' or (p_filter='places' and target->>'kind' in ('place','merchant'))
    or (p_filter='users' and target->>'kind'='user') or (p_filter='jobs' and card->>'postType'='job')
    or (p_filter='posts' and target->>'kind'='post' and card->>'postType'<>'job'))
   and (p_folder_id is null or folders @> jsonb_build_array(p_folder_id))
   and (btrim(p_query)='' or strpos(lower(coalesce(card->>'title','')||' '||coalesce(card->>'_searchText',card->>'subtitle','')),lower(btrim(p_query)))>0)
   and (p_before_saved_at is null or (saved_at,key collate "C")<(p_before_saved_at,p_before_key collate "C"))
  order by saved_at desc,key collate "C" desc limit 31
 ), shown as materialized(select * from page order by saved_at desc,key collate "C" desc limit 30)
 select jsonb_build_object('items',coalesce((select jsonb_agg(item order by saved_at desc,key collate "C" desc) from shown),'[]'::jsonb),
  'hasMore',(select count(*)>30 from page),'nextCursor',case when (select count(*)>30 from page) then
   (select jsonb_build_object('savedAt',saved_at,'key',key) from shown order by saved_at,key collate "C" limit 1) else null end) into result;
 return result;
end $$;
create function public.get_saved_folders() returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); begin
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by created_at,id),'[]'::jsonb) from private.saved_folders where user_id=uid);
end $$;
create function public.create_saved_folder(p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); item private.saved_folders; begin
 if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' then raise exception 'INVALID_SAVED_FOLDER'; end if;
 if (select count(*) from private.saved_folders where user_id=uid)>=100 then raise exception 'SAVED_FOLDER_LIMIT'; end if;
 insert into private.saved_folders(user_id,name) values(uid,btrim(p_name)) returning * into item;
 return jsonb_build_object('id',item.id,'name',item.name);
end $$;
create function public.rename_saved_folder(p_folder_id uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); item private.saved_folders; begin
 if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' then raise exception 'INVALID_SAVED_FOLDER'; end if;
 update private.saved_folders set name=btrim(p_name) where user_id=uid and id=p_folder_id returning * into item;
 if not found then raise exception 'FOLDER_UNAVAILABLE'; end if;
 return jsonb_build_object('id',item.id,'name',item.name);
end $$;
create function public.delete_saved_folder(p_folder_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); begin
 delete from private.saved_folders where user_id=uid and id=p_folder_id;
 if not found then raise exception 'FOLDER_UNAVAILABLE'; end if;
 return true;
end $$;
create function public.set_saved_item_folders(p_kind text,p_id text,p_folder_ids uuid[],p_city_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.saved_owner(true); ref jsonb; source record; member_ids uuid[]; fid uuid; begin
 perform private.saved_validate(p_kind,p_id,p_city_id);
 if p_folder_ids is null or cardinality(p_folder_ids)>100 or array_position(p_folder_ids,null) is not null
  or (select count(distinct v) from unnest(p_folder_ids)v)<>cardinality(p_folder_ids) then raise exception 'INVALID_SAVED_FOLDER'; end if;
 if (select count(*) from private.saved_folders where user_id=uid and id=any(p_folder_ids))<>cardinality(p_folder_ids) then raise exception 'FOLDER_UNAVAILABLE'; end if;
 -- FK key-share locks also serialize with an old client's direct post unsave.
 perform 1 from private.saved_folders where user_id=uid and id=any(p_folder_ids) for key share;
 ref:=private.saved_ref(p_kind,p_id,p_city_id);
 if cardinality(p_folder_ids)>0 and private.saved_card(ref) is null then raise exception 'SAVED_TARGET_UNAVAILABLE'; end if;
 select * into source from private.saved_sources(uid) where key=private.saved_key(ref) order by saved_at desc,kind,id limit 1;
 if not found then raise exception 'SAVED_ITEM_REQUIRED'; end if;
 select array_agg(f.id) into member_ids from private.saved_folder_items f where f.user_id=uid and private.saved_key(private.saved_member_source(f))=private.saved_key(ref);
 delete from private.saved_folder_items where user_id=uid and id=any(member_ids);
 foreach fid in array p_folder_ids loop
  insert into private.saved_folder_items(user_id,folder_id,post_id,merchant_id,person_id,place_city_id,place_key) values
   (uid,fid,case when source.kind='post' then source.id::uuid end,case when source.kind='merchant' then source.id::uuid end,
    case when source.kind='user' then source.id::uuid end,case when source.kind='place' then source.city end,case when source.kind='place' then source.id end);
 end loop;
 return true;
exception when foreign_key_violation then raise exception 'SAVED_ITEM_REQUIRED';
end $$;

-- Legacy callers see the same logical bookmark after a later place connection.
create or replace function public.set_saved_merchant(p_merchant_id uuid,p_saved boolean) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 if p_merchant_id is null or p_saved is null then raise exception 'INVALID_SAVED_MERCHANT'; end if;
 perform public.set_saved_item('merchant',p_merchant_id::text,p_saved);
 return p_saved;
exception when raise_exception then
 if sqlerrm='SAVED_TARGET_UNAVAILABLE' then raise exception 'MERCHANT_UNAVAILABLE'; end if;
 raise;
end $$;
create or replace function public.get_saved_merchants(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); result jsonb; begin
 if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'INVALID_MERCHANT_OFFSET'; end if;
 with groups as materialized (
  select (target->>'id')::uuid merchant_id,max(saved_at) saved_at from private.saved_sources(uid) where target->>'kind'='merchant' group by target->>'id'
 ), visible as materialized (
  select g.*,p.profile from groups g cross join lateral(select public.get_merchant_profile(g.merchant_id) profile)p
   where p.profile is not null order by saved_at desc,merchant_id desc limit 21 offset p_offset
 ) select jsonb_build_object('merchants',coalesce((select jsonb_agg(profile order by saved_at desc,merchant_id desc) from
  (select * from visible order by saved_at desc,merchant_id desc limit 20)p),'[]'::jsonb),'has_more',(select count(*)>20 from visible)) into result;
 return result;
end $$;
create or replace function public.set_saved_merchant_notifications(p_merchant_id uuid,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); stamp timestamptz; begin
 if p_merchant_id is null or p_enabled is null then raise exception 'INVALID_SAVED_MERCHANT'; end if;
 perform 1 from private.merchants where id=p_merchant_id for share;
 if public.get_merchant_profile(p_merchant_id) is null then raise exception 'MERCHANT_UNAVAILABLE'; end if;
 stamp:=private.saved_merchant_at(uid,p_merchant_id);
 if stamp is null then raise exception 'SAVED_MERCHANT_REQUIRED'; end if;
 if p_enabled then
  insert into private.saved_merchants(user_id,merchant_id,created_at,notifications_enabled) values(uid,p_merchant_id,stamp,true)
   on conflict(user_id,merchant_id) do update set notifications_enabled=true;
 else update private.saved_merchants set notifications_enabled=false where user_id=uid and merchant_id=p_merchant_id; end if;
 return p_enabled;
end $$;
create function private.erase_saved_library() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 delete from private.saved_folders where user_id=new.id;
 delete from private.saved_places where user_id=new.id;
 delete from private.saved_users where user_id=new.id or target_user_id=new.id;
 return new;
end $$;
create trigger profiles_erase_saved_library after update of account_status on public.profiles
 for each row when(new.account_status='deleted' and old.account_status is distinct from new.account_status) execute function private.erase_saved_library();
do $$ declare proc record; begin
 for proc in select n.nspname,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='private' and p.proname in ('saved_validate','saved_owner','saved_ref','saved_key','saved_sources','saved_merchant_at','saved_place_info','saved_card','saved_member_source','saved_group_folders','saved_state','erase_saved_library'))
   or (n.nspname='public' and p.proname in ('get_saved_item_state','set_saved_item','get_saved_items','get_saved_folders','create_saved_folder','rename_saved_folder','delete_saved_folder','set_saved_item_folders','set_saved_merchant','get_saved_merchants','set_saved_merchant_notifications')) loop
  execute format('alter function %s owner to postgres',proc.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',proc.signature);
  if proc.nspname='public' then execute format('grant execute on function %s to authenticated',proc.signature); end if;
 end loop;
end $$;
-- Fixed control IDs only; target/folder/person identifiers are never analytics data.
insert into private.behavior_targets(id) values
 ('save.place'),('save.user'),('saved.search.clear'),('saved.open.merchant'),('saved.open.place'),('saved.open.post'),('saved.open.user'),
 ('saved.organize'),('saved.remove'),('saved.compare'),('saved.filter.all'),('saved.filter.places'),('saved.filter.posts'),('saved.filter.jobs'),('saved.filter.users'),
 ('saved.folder.all'),('saved.folder.select'),('saved.folder.new'),('saved.folder.manage'),('saved.editor.backdrop'),('saved.editor.close'),('saved.editor.submit'),
 ('saved.editor.delete'),('saved.editor.new'),('saved.editor.select') on conflict do nothing;
notify pgrst,'reload schema';
