-- 저장 폴더 묶음 (owner 2026-11-13): a folder can be shown to friends, and friends see it on the profile.

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

-- What anyone but the owner sees in a folder: its catalog places and consented businesses, the profile map's rule
-- (private.profile_saved_places). Saved posts and people never leave the owner. The app names places from its catalog.
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
 ) x order by coalesce(x.merchant_id::text,x.city_id||':'||x.place_key),x.added_at desc
$$;

-- 'owner'; 'viewer' for an accepted friend who passes friend_pair_ok (blocks, reports, operated characters and
-- inactive accounts drop out) while the folder is 'friends' and the owner shares saved places; otherwise null.
create function private.saved_folder_role(p_viewer uuid,p_folder uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when f.user_id=p_viewer then 'owner'
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
   from (select * from private.saved_folder_places(p_folder_id) order by added_at desc limit 300) x left join private.merchants m on m.id=x.merchant_id));
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

-- The caller's saved list carries their memo; the account eraser drops memos with the rest of the library.
do $$ declare r record; d text; begin
 for r in select * from (values
  ('public.get_saved_items(text,text,uuid,timestamp with time zone,text)','''folderIds'',folders\)',
   '''folderIds'',folders,''note'',(select n.note from private.saved_item_notes n where n.user_id=uid and n.saved_key=cards.key))'),
  ('private.erase_saved_library()','delete from private\.saved_folders where user_id=new\.id;',
   'delete from private.saved_folders where user_id=new.id; delete from private.saved_item_notes where user_id=new.id;')
 ) v(fn,pattern,replacement) loop
  d:=pg_get_functiondef(r.fn::regprocedure);
  if regexp_count(d,r.pattern)<>1 then raise exception 'SAVED_FOLDER_SHARING_ANCHOR_CHANGED %',r.fn; end if;
  execute regexp_replace(d,r.pattern,r.replacement);
 end loop;
end $$;

-- 6) On a place screen: friends' folders that hold the place. A folder shows only if this member may open it
-- (saved_folder_role) and the place is one friends see in it (saved_folder_places).
create index saved_folder_items_place on private.saved_folder_items(place_city_id,place_key) where place_key is not null;
create index saved_folder_items_merchant on private.saved_folder_items(merchant_id) where merchant_id is not null;

create function public.get_place_friend_folders(p_city_id text,p_place_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid:=private.saved_owner(); v_merchant uuid; begin
 perform private.saved_validate('place',p_place_key,p_city_id);
 select l.merchant_id into v_merchant from private.webshop_place_links l where l.place_key=p_place_key and l.city_id=p_city_id;
 return (select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]'::jsonb) from (
  select f.id,f.created_at,private.saved_folder_json(f)||jsonb_build_object('owner',jsonb_build_object('id',p.id,'nickname',p.nickname)) item
  from private.saved_folders f join public.profiles p on p.id=f.user_id
  where f.id in (select i.folder_id from private.saved_folder_items i
    where i.user_id in (select case when r.user_low_id=uid then r.user_high_id else r.user_low_id end from private.friendships r
      where (r.user_low_id=uid or r.user_high_id=uid) and r.accepted_at is not null)
     and ((i.place_city_id=p_city_id and i.place_key=p_place_key) or (v_merchant is not null and i.merchant_id=v_merchant)))
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

do $$ declare signature text; begin
 foreach signature in array array['private.saved_folder_places(uuid)','private.saved_folder_role(uuid,uuid)','private.saved_folder_json(private.saved_folders)',
  'public.save_saved_folder(uuid,text,text,text)','public.set_saved_folder_cover(uuid,text,text)','public.get_saved_folder(uuid)','public.get_friend_saved_folders(uuid)',
  'public.set_saved_note(text,text,text,text)','public.get_place_friend_folders(text,text)',
  'public.copy_saved_folder(uuid)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.save_saved_folder(uuid,text,text,text),public.set_saved_folder_cover(uuid,text,text),public.get_saved_folder(uuid),public.get_friend_saved_folders(uuid),
 public.set_saved_note(text,text,text,text),public.get_place_friend_folders(text,text),public.copy_saved_folder(uuid) to authenticated;

-- An unknown target rejects the whole analytics batch, so these must reach production before the app build.
insert into private.behavior_targets(id) values
 ('saved.editor.visibility.on'),('saved.editor.visibility.off'),('saved.folder.open'),('folder.scroll'),('folder.place.open'),('user.folder.open'),
 ('folder.cover.open'),('folder.cover.scroll'),('folder.cover.pick'),
 ('saved.note'),('saved.note.close'),('saved.note.submit'),('saved.note.delete'),('places.friend-folder.open'),('folder.copy'),('folder.copy.open')
on conflict (id) do nothing;
notify pgrst,'reload schema';
