-- 저장 폴더 묶음 (owner 2026-11-13): a folder can be shown to friends, and friends see it on the profile.
-- notifications (sections 5 and 7) and the safety tables (section 7) take a short exclusive lock: give up fast instead of
-- queueing app requests (apply off-peak).
set local lock_timeout = '5s';

-- 1) Each folder is 'friends' or 'private'. Folders made before this stay private: the app told their owners
-- "폴더는 나만 볼 수 있어요". Only save_saved_folder (new apps) starts one as 'friends', like saved places. An old
-- app's create_saved_folder still makes a private folder, because that app still says folders are private.
alter table private.saved_folders add column visibility text not null default 'private' check(visibility in ('private','friends'));

-- 2) A short description and a cover picked from the folder's own places (no uploads). With no pick, or once the
-- picked place leaves the folder, the newest place is the cover.
alter table private.saved_folders
 add column description text check(description is null or (length(description) between 1 and 150 and description=btrim(description) and description!~'[[:cntrl:]]')),
 add column cover_city_id text, add column cover_place_key text,
 add constraint saved_folders_cover_pair check(num_nulls(cover_city_id,cover_place_key) in (0,2));

-- 5) Folders made together. The owner invites friends as editors; an editor adds and removes places, only the owner
-- renames, changes who sees it or deletes it. An invite waits until accepted, and unfriending ends it (trigger below).
create table private.saved_folder_members (
 folder_id uuid not null references private.saved_folders(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 invited_at timestamptz not null default clock_timestamp(),
 accepted_at timestamptz,
 primary key(folder_id,user_id)
);
create index saved_folder_members_user on private.saved_folder_members(user_id);
-- Places an editor put in. The owner's own places stay saved items of the owner (saved_folder_items).
create table private.saved_folder_shared_places (
 id uuid primary key default gen_random_uuid(),
 folder_id uuid not null references private.saved_folders(id) on delete cascade,
 city_id text not null references public.cities(id),
 place_key text check(place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$'),
 merchant_id uuid references private.merchants(id) on delete cascade,
 added_by uuid not null references public.profiles(id) on delete cascade,
 added_at timestamptz not null default clock_timestamp(),
 check(num_nonnulls(place_key,merchant_id)=1)
);
create unique index saved_folder_shared_place on private.saved_folder_shared_places(folder_id,city_id,place_key) where place_key is not null;
create unique index saved_folder_shared_merchant on private.saved_folder_shared_places(folder_id,merchant_id) where merchant_id is not null;
create index saved_folder_shared_added_by on private.saved_folder_shared_places(added_by);
do $$ declare t text; begin
 foreach t in array array['saved_folder_members','saved_folder_shared_places'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('alter table private.%I owner to postgres',t);
 end loop;
end $$;

-- What anyone but the owner sees in a folder: its catalog places and consented businesses, the profile map's rule
-- (private.profile_saved_places), plus places editors put in. Saved posts and people never leave the owner.
-- The app names places from its catalog.
create function private.saved_folder_places(p_folder uuid) returns table(city_id text,place_key text,merchant_id uuid,added_at timestamptz)
language sql stable security definer set search_path='' as $$
 select distinct on (coalesce(x.merchant_id::text,x.city_id||':'||x.place_key)) x.city_id,x.place_key,x.merchant_id,x.added_at from (
  select i.place_city_id city_id,i.place_key,m.id merchant_id,s.created_at added_at
  from private.saved_folder_items i
  join private.saved_places s on s.user_id=i.user_id and s.city_id=i.place_city_id and s.place_key=i.place_key
  left join private.webshop_place_links l on l.place_key=i.place_key and l.city_id=i.place_city_id
  left join private.merchants m on m.id=l.merchant_id and m.city_id=l.city_id and m.record_kind='business'
   and m.deleted_at is null and m.status<>'paused' and m.consent='granted'
  where i.folder_id=p_folder and i.place_key is not null
  union all
  select m.city_id,l.place_key,m.id,sm.created_at
  from private.saved_folder_items i
  join private.saved_merchants sm on sm.user_id=i.user_id and sm.merchant_id=i.merchant_id
  join private.merchants m on m.id=i.merchant_id and m.record_kind='business' and m.deleted_at is null and m.status<>'paused' and m.consent='granted'
  left join private.webshop_place_links l on l.merchant_id=m.id and l.city_id=m.city_id
  where i.folder_id=p_folder and i.merchant_id is not null
  union all
  select sp.city_id,sp.place_key,m.id,sp.added_at
  from private.saved_folder_shared_places sp
  left join private.webshop_place_links l on l.place_key=sp.place_key and l.city_id=sp.city_id
  left join private.merchants m on m.id=l.merchant_id and m.city_id=l.city_id and m.record_kind='business'
   and m.deleted_at is null and m.status<>'paused' and m.consent='granted'
  where sp.folder_id=p_folder and sp.place_key is not null
  union all
  select m.city_id,l.place_key,m.id,sp.added_at
  from private.saved_folder_shared_places sp
  join private.merchants m on m.id=sp.merchant_id and m.record_kind='business' and m.deleted_at is null and m.status<>'paused' and m.consent='granted'
  left join private.webshop_place_links l on l.merchant_id=m.id and l.city_id=m.city_id
  where sp.folder_id=p_folder and sp.merchant_id is not null
 ) x order by coalesce(x.merchant_id::text,x.city_id||':'||x.place_key),x.added_at desc
$$;

-- 'owner'; 'editor' for a friend who accepted the owner's invite; 'viewer' for a friend while the folder is 'friends' and
-- the owner shares saved places; otherwise null. Both friend cases need friend_pair_ok (blocks, reports, operated
-- characters and inactive accounts drop out). An editor was invited by name, so neither setting hides it from them.
create function private.saved_folder_role(p_viewer uuid,p_folder uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when f.user_id=p_viewer then 'owner'
  when exists(select 1 from private.saved_folder_members m where m.folder_id=f.id and m.user_id=p_viewer and m.accepted_at is not null)
   and private.are_friends(p_viewer,f.user_id) and private.friend_pair_ok(p_viewer,f.user_id) then 'editor'
  when private.are_friends(p_viewer,f.user_id) and private.friend_pair_ok(p_viewer,f.user_id)
   and f.visibility='friends' and coalesce((select s.saved_places_to_friends from private.profile_sharing s where s.user_id=f.user_id),true) then 'viewer'
  end
 from private.saved_folders f where f.id=p_folder and p_viewer is not null
$$;

create function private.saved_folder_json(p_folder private.saved_folders) returns jsonb
language sql stable security definer set search_path='' as $$
 with p as (select * from private.saved_folder_places(p_folder.id))
 select jsonb_build_object('id',p_folder.id,'name',p_folder.name,'visibility',p_folder.visibility,'description',p_folder.description,
  'placeCount',(select count(*)::integer from p),
  'cover',(select jsonb_build_object('cityId',c.city_id,'placeKey',c.place_key) from p c where c.place_key is not null
   order by (c.city_id=p_folder.cover_city_id and c.place_key=p_folder.cover_place_key) desc nulls last,c.added_at desc,c.place_key limit 1))
$$;

-- Old apps read id and name; the extra fields ride along.
create or replace function public.get_saved_folders() returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); begin
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'visibility',visibility,'description',description) order by created_at,id),'[]'::jsonb)
  from private.saved_folders where user_id=uid);
end $$;

-- Creates (p_folder_id null) or edits one of the caller's folders. A blank description clears it.
create function public.save_saved_folder(p_folder_id uuid,p_name text,p_visibility text,p_description text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); item private.saved_folders;
 v_description text:=nullif(btrim(p_description),''); begin
 if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' or p_visibility is null or p_visibility not in ('private','friends')
  or length(v_description)>150 or v_description ~ '[[:cntrl:]]' then raise exception 'INVALID_SAVED_FOLDER'; end if;
 if p_folder_id is null then
  if (select count(*) from private.saved_folders where user_id=uid)>=100 then raise exception 'SAVED_FOLDER_LIMIT'; end if;
  insert into private.saved_folders(user_id,name,visibility,description) values(uid,btrim(p_name),p_visibility,v_description) returning * into item;
 else
  update private.saved_folders set name=btrim(p_name),visibility=p_visibility,description=v_description where user_id=uid and id=p_folder_id returning * into item;
  if not found then raise exception 'FOLDER_UNAVAILABLE'; end if;
 end if;
 return private.saved_folder_json(item);
end $$;

-- The owner picks the cover from the folder's places; both null goes back to the newest place.
create function public.set_saved_folder_cover(p_folder_id uuid,p_city_id text,p_place_key text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); item private.saved_folders; begin
 if num_nulls(p_city_id,p_place_key)=1 then raise exception 'INVALID_SAVED_FOLDER_COVER'; end if;
 if private.saved_folder_role(uid,p_folder_id) is distinct from 'owner' then raise exception 'FOLDER_UNAVAILABLE'; end if;
 if p_place_key is not null and not exists(select 1 from private.saved_folder_places(p_folder_id) x where x.city_id=p_city_id and x.place_key=p_place_key)
  then raise exception 'FOLDER_COVER_UNAVAILABLE'; end if;
 update private.saved_folders set cover_city_id=p_city_id,cover_place_key=p_place_key where id=p_folder_id and user_id=uid returning * into item;
 return private.saved_folder_json(item);
end $$;

-- One folder as the viewer may see it. No access and no such folder give the same FOLDER_UNAVAILABLE.
create function public.get_saved_folder(p_folder_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); f private.saved_folders; v_role text; begin
 v_role:=private.saved_folder_role(uid,p_folder_id);
 if v_role is null then raise exception 'FOLDER_UNAVAILABLE'; end if;
 select * into f from private.saved_folders where id=p_folder_id;
 return private.saved_folder_json(f)||jsonb_build_object('role',v_role,
  'owner',(select jsonb_build_object('id',p.id,'nickname',p.nickname) from public.profiles p where p.id=f.user_id),
  'places',(select coalesce(jsonb_agg(jsonb_build_object('cityId',x.city_id,'placeKey',x.place_key,'merchantId',x.merchant_id,'name',m.name,'address',m.address)
    order by x.added_at desc,coalesce(x.merchant_id::text,x.place_key)),'[]'::jsonb)
   from (select * from private.saved_folder_places(p_folder_id) order by added_at desc limit 300) x left join private.merchants m on m.id=x.merchant_id))
  ||case when v_role='owner' then jsonb_build_object('members',private.saved_folder_members_json(p_folder_id)) else '{}'::jsonb end;
end $$;

-- A friend's folders on their profile. A folder with no place to show stays hidden, so a folder of saved posts never
-- shows its name.
create function public.get_friend_saved_folders(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); begin
 if p_user_id is null then raise exception 'INVALID_PROFILE'; end if;
 return (select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]'::jsonb) from (
  select f.id,f.created_at,private.saved_folder_json(f) item from private.saved_folders f
  where f.user_id=p_user_id and f.user_id<>uid and private.saved_folder_role(uid,f.id) is not null) x
  where (x.item->>'placeCount')::integer>0);
end $$;

-- 3) A memo on a saved item. Only its writer reads it: get_saved_items is the one reader, and it is the caller's own list.
-- The memo hangs on the saved-item key, so a place and its business share one memo, like they share one card.
create table private.saved_item_notes (
 user_id uuid not null references public.profiles(id) on delete cascade,
 saved_key text not null check(length(saved_key) between 3 and 300),
 note text not null check(length(note) between 1 and 200 and note=btrim(note) and note!~'[[:cntrl:]]'),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,saved_key)
);
alter table private.saved_item_notes enable row level security;
revoke all on private.saved_item_notes from public,anon,authenticated,service_role;
alter table private.saved_item_notes owner to postgres;

-- A blank memo deletes it. Writing a memo also drops memos left on items that are no longer saved.
create function public.set_saved_note(p_kind text,p_id text,p_note text,p_city_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); k text; v_note text:=nullif(btrim(p_note),''); begin
 perform private.saved_validate(p_kind,p_id,p_city_id);
 if length(v_note)>200 or v_note ~ '[[:cntrl:]]' then raise exception 'INVALID_SAVED_NOTE'; end if;
 k:=private.saved_key(private.saved_ref(p_kind,p_id,p_city_id));
 if v_note is null then delete from private.saved_item_notes where user_id=uid and saved_key=k;
 else
  if not exists(select 1 from private.saved_sources(uid) s where s.key=k) then raise exception 'SAVED_TARGET_UNAVAILABLE'; end if;
  delete from private.saved_item_notes n where n.user_id=uid and n.saved_key not in (select s.key from private.saved_sources(uid) s where s.key is not null);
  insert into private.saved_item_notes(user_id,saved_key,note) values(uid,k,v_note)
   on conflict(user_id,saved_key) do update set note=excluded.note,updated_at=clock_timestamp();
 end if;
 return jsonb_build_object('key',k,'note',v_note);
end $$;

-- The caller's saved list carries their memo. The account eraser drops memos, folder memberships and the places the
-- member put in friends' folders with the rest of the library (the profile row stays, so cascades never fire).
do $$ declare r record; d text; begin
 for r in select * from (values
  ('public.get_saved_items(text,text,uuid,timestamp with time zone,text)','''folderIds'',folders\)',
   '''folderIds'',folders,''note'',(select n.note from private.saved_item_notes n where n.user_id=uid and n.saved_key=cards.key))'),
  ('private.erase_saved_library()','delete from private\.saved_folders where user_id=new\.id;',
   'delete from private.saved_folders where user_id=new.id; delete from private.saved_item_notes where user_id=new.id; '||
   'delete from private.saved_folder_members where user_id=new.id; delete from private.saved_folder_shared_places where added_by=new.id;')
 ) v(fn,pattern,replacement) loop
  d:=pg_get_functiondef(r.fn::regprocedure);
  if regexp_count(d,r.pattern)<>1 then raise exception 'SAVED_FOLDER_SHARING_ANCHOR_CHANGED %',r.fn; end if;
  execute regexp_replace(d,r.pattern,r.replacement);
 end loop;
end $$;

-- 6) On a place screen: friends' folders that hold the place. A folder shows only if this member may open it
-- (saved_folder_role) and the place is one friends see in it (saved_folder_places).

create function public.get_place_friend_folders(p_city_id text,p_place_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); v_merchant uuid; begin
 perform private.saved_validate('place',p_place_key,p_city_id);
 select l.merchant_id into v_merchant from private.webshop_place_links l where l.place_key=p_place_key and l.city_id=p_city_id;
 return (select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]'::jsonb) from (
  select f.id,f.created_at,private.saved_folder_json(f)||jsonb_build_object('owner',jsonb_build_object('id',p.id,'nickname',p.nickname)) item
  from private.saved_folders f join public.profiles p on p.id=f.user_id
  where f.user_id in (select case when r.user_low_id=uid then r.user_high_id else r.user_low_id end from private.friendships r
    where (r.user_low_id=uid or r.user_high_id=uid) and r.accepted_at is not null)
   and (exists(select 1 from private.saved_folder_items i where i.folder_id=f.id
     and ((i.place_city_id=p_city_id and i.place_key=p_place_key) or (v_merchant is not null and i.merchant_id=v_merchant)))
    or exists(select 1 from private.saved_folder_shared_places sp where sp.folder_id=f.id
     and ((sp.city_id=p_city_id and sp.place_key=p_place_key) or (v_merchant is not null and sp.merchant_id=v_merchant))))
   and private.saved_folder_role(uid,f.id) is not null
   and exists(select 1 from private.saved_folder_places(f.id) s where (s.city_id=p_city_id and s.place_key=p_place_key) or s.merchant_id=v_merchant)
  order by f.created_at desc,f.id limit 10) x);
end $$;

-- 4) "내 폴더로 저장": copies the places a friend's folder shows right now into a new folder of the caller's.
-- It is a copy: the friend's later edits never reach it. It starts private, because the picks are the friend's.
-- The copied places are saved into the caller's library too (a folder only holds saved items); places already
-- saved keep their saved time. Up to 100 places per copy, the newest first; one the app cannot show is skipped.
create function public.copy_saved_folder(p_folder_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); f private.saved_folders;
 item private.saved_folders; v_role text; v_suffix text; v_total integer; v_copied integer:=0; x record; begin
 v_role:=private.saved_folder_role(uid,p_folder_id);
 if v_role is null or v_role='owner' then raise exception 'FOLDER_UNAVAILABLE'; end if;
 if (select count(*) from private.saved_folders where user_id=uid)>=100 then raise exception 'SAVED_FOLDER_LIMIT'; end if;
 perform private.enforce_rate_limit('saved_folder_copy',20,interval '1 day');
 select * into f from private.saved_folders where id=p_folder_id;
 select ' · '||left(coalesce(nullif(btrim(p.nickname),''),'친구'),30) into v_suffix from public.profiles p where p.id=f.user_id;
 insert into private.saved_folders(user_id,name,visibility) values(uid,btrim(left(f.name,80-char_length(v_suffix)))||v_suffix,'private') returning * into item;
 select count(*) into v_total from private.saved_folder_places(p_folder_id);
 for x in select * from private.saved_folder_places(p_folder_id) order by added_at desc,coalesce(merchant_id::text,place_key) limit 100 loop
  continue when private.saved_card(case when x.merchant_id is not null then private.saved_ref('merchant',x.merchant_id::text,null)
   else private.saved_ref('place',x.place_key,x.city_id) end) is null;
  if x.merchant_id is not null then
   insert into private.saved_merchants(user_id,merchant_id) values(uid,x.merchant_id) on conflict do nothing;
   insert into private.saved_folder_items(user_id,folder_id,merchant_id) values(uid,item.id,x.merchant_id) on conflict do nothing;
  else
   insert into private.saved_places(user_id,city_id,place_key) values(uid,x.city_id,x.place_key) on conflict do nothing;
   insert into private.saved_folder_items(user_id,folder_id,place_city_id,place_key) values(uid,item.id,x.city_id,x.place_key) on conflict do nothing;
  end if;
  v_copied:=v_copied+1;
 end loop;
 return private.saved_folder_json(item)||jsonb_build_object('copied',v_copied,'total',v_total);
end $$;

-- 5) Folders made together: invites, accepting, leaving and editors' places.
-- The owner's view of who is in: accepted editors and open invites, for friends still in good standing.
create function private.saved_folder_members_json(p_folder uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,'accepted',m.accepted_at is not null) order by m.invited_at,p.id),'[]'::jsonb)
 from private.saved_folder_members m join private.saved_folders f on f.id=m.folder_id join public.profiles p on p.id=m.user_id
 where m.folder_id=p_folder and private.are_friends(f.user_id,m.user_id) and private.friend_pair_ok(f.user_id,m.user_id)
$$;

-- The owner invites a friend. A new invite lands in the bell like a friend request; inviting again changes nothing.
create function public.invite_saved_folder_member(p_folder_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); f private.saved_folders; v_nickname text; begin
 if private.saved_folder_role(uid,p_folder_id) is distinct from 'owner' then raise exception 'FOLDER_UNAVAILABLE'; end if;
 if p_user_id is null or p_user_id=uid or not private.are_friends(uid,p_user_id) or not private.friend_pair_ok(uid,p_user_id) then raise exception 'FOLDER_MEMBER_NOT_FRIEND'; end if;
 if not exists(select 1 from private.saved_folder_members where folder_id=p_folder_id and user_id=p_user_id) then
  if (select count(*) from private.saved_folder_members where folder_id=p_folder_id)>=10 then raise exception 'FOLDER_MEMBER_LIMIT'; end if;
  perform private.enforce_rate_limit('saved_folder_invite',30,interval '1 day');
  insert into private.saved_folder_members(folder_id,user_id) values(p_folder_id,p_user_id);
  select * into f from private.saved_folders where id=p_folder_id;
  select coalesce(nullif(btrim(nickname),''),'친구') into v_nickname from public.profiles where id=uid;
  perform private.create_notification(p_user_id,'saved_folder_invite',uid,'user',uid,
   v_nickname||'님이 「'||left(f.name,40)||'」 폴더를 같이 만들자고 했어요.','/profile/saved');
 end if;
 return private.saved_folder_members_json(p_folder_id);
end $$;

create function public.accept_saved_folder_invite(p_folder_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); f private.saved_folders; begin
 select * into f from private.saved_folders where id=p_folder_id;
 if f.id is null or not private.are_friends(uid,f.user_id) or not private.friend_pair_ok(uid,f.user_id) then raise exception 'FOLDER_UNAVAILABLE'; end if;
 update private.saved_folder_members set accepted_at=clock_timestamp() where folder_id=p_folder_id and user_id=uid and accepted_at is null;
 if not found then raise exception 'FOLDER_UNAVAILABLE'; end if;
 return private.saved_folder_json(f);
end $$;

-- The owner takes someone out; anyone declines an invite or leaves on their own.
create function public.remove_saved_folder_member(p_folder_id uuid,p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); begin
 if p_user_id is null or (p_user_id<>uid and private.saved_folder_role(uid,p_folder_id) is distinct from 'owner') then raise exception 'FOLDER_UNAVAILABLE'; end if;
 delete from private.saved_folder_members where folder_id=p_folder_id and user_id=p_user_id;
 return found;
end $$;

-- Invites waiting for this member, and folders they edit with a friend.
create function public.get_shared_saved_folders() returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); begin
 return jsonb_build_object(
  'invites',(select coalesce(jsonb_agg(x.item order by x.invited_at desc,x.id),'[]'::jsonb) from (
   select f.id,m.invited_at,jsonb_build_object('id',f.id,'name',f.name,'owner',jsonb_build_object('id',p.id,'nickname',p.nickname),'invitedAt',m.invited_at) item
   from private.saved_folder_members m join private.saved_folders f on f.id=m.folder_id join public.profiles p on p.id=f.user_id
   where m.user_id=uid and m.accepted_at is null and private.are_friends(uid,f.user_id) and private.friend_pair_ok(uid,f.user_id)
   order by m.invited_at desc,f.id limit 20) x),
  'folders',(select coalesce(jsonb_agg(x.item order by x.accepted_at desc,x.id),'[]'::jsonb) from (
   select f.id,m.accepted_at,private.saved_folder_json(f)||jsonb_build_object('owner',jsonb_build_object('id',p.id,'nickname',p.nickname)) item
   from private.saved_folder_members m join private.saved_folders f on f.id=m.folder_id join public.profiles p on p.id=f.user_id
   where m.user_id=uid and m.accepted_at is not null and private.saved_folder_role(uid,f.id)='editor'
   order by m.accepted_at desc,f.id limit 100) x));
end $$;

-- An editor puts one of their own saved places in, or the owner or an editor takes a place out (wherever it came from).
create function public.set_saved_folder_place(p_folder_id uuid,p_kind text,p_id text,p_in boolean,p_city_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(true); v_role text; ref jsonb; k text; begin
 if p_kind is null or p_kind not in ('place','merchant') or p_in is null then raise exception 'INVALID_SAVED_TARGET'; end if;
 perform private.saved_validate(p_kind,p_id,p_city_id);
 v_role:=private.saved_folder_role(uid,p_folder_id);
 if v_role is null or v_role='viewer' then raise exception 'FOLDER_UNAVAILABLE'; end if;
 ref:=private.saved_ref(p_kind,p_id,p_city_id); k:=private.saved_key(ref);
 if p_in then
  if v_role<>'editor' then raise exception 'FOLDER_OWNER_USES_LIBRARY'; end if;
  if not exists(select 1 from private.saved_sources(uid) s where s.key=k) or private.saved_card(ref) is null then raise exception 'SAVED_TARGET_UNAVAILABLE'; end if;
  if (select count(*) from private.saved_folder_shared_places where folder_id=p_folder_id)>=300 then raise exception 'FOLDER_PLACE_LIMIT'; end if;
  perform private.enforce_rate_limit('saved_folder_place',200,interval '1 day');
  if ref->>'kind'='merchant' then
   insert into private.saved_folder_shared_places(folder_id,city_id,merchant_id,added_by) values(p_folder_id,ref->>'cityId',(ref->>'id')::uuid,uid) on conflict do nothing;
  else
   insert into private.saved_folder_shared_places(folder_id,city_id,place_key,added_by) values(p_folder_id,ref->>'cityId',ref->>'id',uid) on conflict do nothing;
  end if;
 else
  delete from private.saved_folder_shared_places sp where sp.folder_id=p_folder_id
   and private.saved_key(private.saved_ref(case when sp.merchant_id is null then 'place' else 'merchant' end,coalesce(sp.merchant_id::text,sp.place_key),sp.city_id))=k;
  delete from private.saved_folder_items i where i.folder_id=p_folder_id and (i.place_key is not null or i.merchant_id is not null)
   and private.saved_key(private.saved_member_source(i))=k;
 end if;
 return true;
end $$;

-- Unfriending (blocks and reports unfriend too) ends any folder made together between the two.
create function private.end_saved_folder_members() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 delete from private.saved_folder_members m using private.saved_folders f where f.id=m.folder_id
  and ((f.user_id=old.user_low_id and m.user_id=old.user_high_id) or (f.user_id=old.user_high_id and m.user_id=old.user_low_id));
 return null;
end $$;
create trigger friendships_end_saved_folder_members after delete on private.friendships for each row execute function private.end_saved_folder_members();

-- Folder invites ride the bell next to friend requests, under the same 'direct_requests' setting.
do $$ declare definition text; anchor constant text:='when ''message_reaction'' then ''messages'''; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
 if definition is null or definition not like 'CHECK (%' or definition like '%saved_folder_invite%' then raise exception 'SAVED_FOLDER_INVITE_KIND_CHANGED'; end if;
 alter table public.notifications drop constraint notifications_kind_check;
 execute 'alter table public.notifications add constraint notifications_kind_check '||replace(definition,'CHECK (','CHECK (kind = ''saved_folder_invite'' or ');
 definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'SAVED_FOLDER_INVITE_CATEGORY_CHANGED'; end if;
 execute replace(definition,anchor,'when ''saved_folder_invite'' then ''direct_requests'' '||anchor);
end $$;

-- 7) ADR-0001: once friends can read a folder, its name and description go through the safety review queue and the
-- watch-term scan like posts and live bubbles. Private folders and memos stay out: nobody else reads them.
create function private.saved_folder_safety_content(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('authorId',f.user_id,'visibility',f.visibility,'createdAt',f.created_at,
  'text',concat_ws(E'\n','저장 폴더 · 보는 사람: '||case f.visibility when 'friends' then '친구' else '나만' end,f.name,f.description))
 from private.saved_folders f where f.id=p_id
$$;
create function public.get_saved_folder_safety_content(p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 return private.saved_folder_safety_content(p_target_id);
end $$;
create function public.get_admin_saved_folder_content(p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare content jsonb;
begin
 if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 content:=private.saved_folder_safety_content(p_target_id);
 if content is null then raise exception 'TARGET_NOT_FOUND'; end if;
 perform public.log_admin_access('safety',(content->>'authorId')::uuid,p_target_id);
 return content;
end $$;

-- Each anchor opens a case list, away from the lines other migrations add, and must occur exactly once.
do $$
declare tbl text; definition text; item record;
begin
 foreach tbl in array array['safety_review_queue','safety_alerts','notifications'] loop
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||tbl)::regclass and conname=tbl||'_target_type_check';
  if definition is null or left(definition,7)<>'CHECK (' or definition like '%saved_folder%' then raise exception 'SAVED_FOLDER_TARGET_CONSTRAINT_CHANGED: %',tbl; end if;
  execute format('alter table public.%I drop constraint %I',tbl,tbl||'_target_type_check');
  execute format('alter table public.%I add constraint %I check ((%s) or target_type=''saved_folder'')',tbl,tbl||'_target_type_check',substring(definition from 8 for char_length(definition)-8));
 end loop;
 for item in select * from (values
  ('private.enqueue_safety_review()',$a$kind text := case tg_table_name$a$,$r$kind text := case tg_table_name when 'saved_folders' then 'saved_folder'$r$),
  ('private.enqueue_safety_review()',$a$content := case tg_table_name$a$,$r$content := case tg_table_name when 'saved_folders' then private.saved_folder_safety_content(new.id)->>'text'$r$),
  ('private.scan_watch_terms()',$a$target text := case tg_table_name$a$,$r$target text := case tg_table_name when 'saved_folders' then 'saved_folder'$r$),
  ('private.scan_watch_terms()',$a$content text := concat_ws(' ', $a$,$r$content text := concat_ws(' ', case when tg_table_name='saved_folders' then concat_ws(' ',row_json->>'name',row_json->>'description') end, $r$),
  ('private.scan_watch_terms()',$a$case when tg_table_name='chilling_profiles' then new.id end$a$,$r$case when tg_table_name='chilling_profiles' then new.id when tg_table_name='saved_folders' then (row_json->>'user_id')::uuid end$r$),
  ('private.notification_target_visible(uuid,text,uuid)',$a$case p_target_type$a$,$r$case p_target_type when 'saved_folder' then private.is_admin_id(p_user_id)$r$),
  ('public.export_admin_safety_evidence(bigint)',$a$content := case a.target_type$a$,$r$content := case a.target_type when 'saved_folder' then private.saved_folder_safety_content(a.target_id)$r$)
 ) v(signature,anchor,replacement) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if array_length(string_to_array(definition,item.anchor),1)<>2 then raise exception 'SAVED_FOLDER_SAFETY_CHANGED %',item.signature; end if;
  execute replace(definition,item.anchor,item.replacement);
 end loop;
end $$;

-- Sent when a friends folder is made or its words change, and when a private folder turns to friends (its earlier
-- words with it). The same words are not sent again: the trigger skips them and the queue keeps one row per folder.
create trigger saved_folders_safety_review after insert on private.saved_folders
 for each row when (new.visibility='friends') execute function private.enqueue_safety_review();
create trigger saved_folders_safety_review_change after update of name,description,visibility on private.saved_folders
 for each row when (new.visibility='friends' and (old.visibility<>'friends' or old.name is distinct from new.name or old.description is distinct from new.description))
 execute function private.enqueue_safety_review();
create trigger saved_folders_watch_terms after insert on private.saved_folders
 for each row when (new.visibility='friends') execute function private.scan_watch_terms();
create trigger saved_folders_watch_terms_change after update of name,description,visibility on private.saved_folders
 for each row when (new.visibility='friends' and (old.visibility<>'friends' or old.name is distinct from new.name or old.description is distinct from new.description))
 execute function private.scan_watch_terms();

do $$ declare signature text; begin
 foreach signature in array array['private.saved_folder_places(uuid)','private.saved_folder_role(uuid,uuid)','private.saved_folder_json(private.saved_folders)',
  'public.save_saved_folder(uuid,text,text,text)','public.set_saved_folder_cover(uuid,text,text)','public.get_saved_folder(uuid)','public.get_friend_saved_folders(uuid)',
  'public.set_saved_note(text,text,text,text)','public.get_place_friend_folders(text,text)',
  'public.copy_saved_folder(uuid)','private.saved_folder_members_json(uuid)','public.invite_saved_folder_member(uuid,uuid)',
  'public.accept_saved_folder_invite(uuid)','public.remove_saved_folder_member(uuid,uuid)','public.get_shared_saved_folders()',
  'public.set_saved_folder_place(uuid,text,text,boolean,text)','private.end_saved_folder_members()',
  'private.saved_folder_safety_content(uuid)','public.get_saved_folder_safety_content(uuid)','public.get_admin_saved_folder_content(uuid)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.save_saved_folder(uuid,text,text,text),public.set_saved_folder_cover(uuid,text,text),public.get_saved_folder(uuid),public.get_friend_saved_folders(uuid),
 public.set_saved_note(text,text,text,text),public.get_place_friend_folders(text,text),public.copy_saved_folder(uuid),
 public.invite_saved_folder_member(uuid,uuid),public.accept_saved_folder_invite(uuid),public.remove_saved_folder_member(uuid,uuid),
 public.get_shared_saved_folders(),public.set_saved_folder_place(uuid,text,text,boolean,text),public.get_admin_saved_folder_content(uuid) to authenticated;
grant execute on function public.get_saved_folder_safety_content(uuid) to service_role;

-- An unknown target rejects the whole analytics batch, so these must reach production before the app build.
insert into private.behavior_targets(id) values
 ('saved.editor.visibility.on'),('saved.editor.visibility.off'),('saved.folder.open'),('folder.scroll'),('folder.place.open'),('user.folder.open'),
 ('folder.cover.open'),('folder.cover.scroll'),('folder.cover.pick'),
 ('saved.note'),('saved.note.close'),('saved.note.submit'),('saved.note.delete'),('places.friend-folder.open'),('folder.copy'),('folder.copy.open'),
 ('saved.invite.accept'),('saved.invite.decline'),('saved.shared.open'),('folder.member.remove'),('folder.member.open'),('folder.member.invite'),('folder.member.scroll'),
 ('folder.place.add.open'),('folder.place.add'),('folder.place.add.scroll'),('folder.place.edit'),('folder.place.remove'),('folder.leave')
on conflict (id) do nothing;
notify pgrst,'reload schema';
