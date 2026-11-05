-- G1 (owner 2026-11-03 "가 보고 싶음·가 봤음 + '가 봤음'은 장소 후기로 잇기"): a saved place is either 가 보고 싶음 or 가 봤음.
-- Only 가 봤음 is stored, against the canonical saved key, so a place that later links to a business keeps it and
-- every older app (set_saved_item) still saves as 가 보고 싶음. Having been somewhere stays true after an unsave.
create table private.saved_place_been (
 user_id uuid not null references public.profiles(id) on delete cascade,
 saved_key text not null check(char_length(saved_key) between 3 and 300),
 been_at timestamptz not null default clock_timestamp(), primary key(user_id,saved_key)
);
alter table private.saved_place_been enable row level security;
revoke all on private.saved_place_been from public,anon,authenticated;

create function private.saved_place_state(p_uid uuid,p_kind text,p_id text,p_city text) returns jsonb
language sql stable security definer set search_path='' as $$
 select s||jsonb_build_object('status',case when not (s->>'saved')::boolean then null
   when exists(select 1 from private.saved_place_been b where b.user_id=p_uid and b.saved_key=private.saved_key(private.saved_ref(p_kind,p_id,p_city))) then 'been' else 'want' end)
 from (select private.saved_state(p_uid,p_kind,p_id,p_city) s) x
$$;

create function public.get_saved_place_state(p_kind text,p_id text,p_city_id text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare uid uuid; begin
 if p_kind not in ('place','merchant') then raise exception 'INVALID_SAVED_TARGET'; end if;
 uid:=private.saved_owner(); perform private.saved_validate(p_kind,p_id,p_city_id);
 return private.saved_place_state(uid,p_kind,p_id,p_city_id);
end $$;

-- p_status 'want' or 'been' saves (or keeps) the place with that status; null unsaves it.
create function public.set_saved_place_state(p_kind text,p_id text,p_status text,p_city_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$ declare uid uuid; result jsonb; key text; begin
 if p_kind not in ('place','merchant') or (p_status is not null and p_status not in ('want','been')) then raise exception 'INVALID_SAVED_TARGET'; end if;
 uid:=private.saved_owner(true);
 result:=public.set_saved_item(p_kind,p_id,p_status is not null,p_city_id);
 if p_status is not null then
  key:=private.saved_key(private.saved_ref(p_kind,p_id,p_city_id));
  if p_status='been' then insert into private.saved_place_been(user_id,saved_key) values(uid,key) on conflict do nothing;
  else delete from private.saved_place_been where user_id=uid and saved_key=key; end if;
 end if;
 return private.saved_place_state(uid,p_kind,p_id,p_city_id);
end $$;

do $$ declare signature text; begin
 foreach signature in array array['private.saved_place_state(uuid,text,text,text)','public.get_saved_place_state(text,text,text)','public.set_saved_place_state(text,text,text,text)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.get_saved_place_state(text,text,text),public.set_saved_place_state(text,text,text,text) to authenticated;

-- An unknown target rejects the whole analytics batch, so these must reach production before the app build.
insert into private.behavior_targets(id) values
  ('save.place.want'),('save.place.been'),('save.place.remove')
on conflict (id) do nothing;
notify pgrst,'reload schema';
