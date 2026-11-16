-- 장소 화면 (owner 2026-11-13): '정보가 달라요' 보내기와 저장한 사람을 가 봤어요·가 보고 싶어요로 나눈 수.

-- 1) A signed-in member tells the operators which part of a map place is wrong. Nobody reads it through the API;
-- the operators read it by SQL, e.g. select city_id,place_key,kind,note,created_at from private.place_corrections order by created_at desc.
create table private.place_corrections (
 id uuid primary key default gen_random_uuid(),
 -- auth.users, not profiles: account deletion keeps a profile tombstone but removes the auth user, so this row goes with it.
 user_id uuid not null references auth.users(id) on delete cascade,
 city_id text not null references public.cities(id),
 place_key text not null check(place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$'),
 kind text not null check(kind in ('hours','address','contact','closed','other')),
 note text check(note=btrim(note) and char_length(note) between 1 and 300 and note !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp()
);
create index place_corrections_member_place on private.place_corrections(user_id,city_id,place_key,created_at desc);
alter table private.place_corrections enable row level security;
revoke all on private.place_corrections from public,anon,authenticated,service_role;
alter table private.place_corrections owner to postgres;

create function public.report_place_correction(p_city_id text,p_place_key text,p_kind text,p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); clean text:=nullif(btrim(regexp_replace(coalesce(p_note,''),'[[:space:]]+',' ','g')),'');
begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if;
 perform private.assert_active_account(uid);
 if p_city_id is null or p_city_id !~ '^[a-z][a-z0-9-]{0,63}$' or not exists(select 1 from public.cities c where c.id=p_city_id)
  or p_place_key is null or not (p_place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or p_place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$')
  or p_kind is null or p_kind not in ('hours','address','contact','closed','other')
  or char_length(clean)>300 or clean ~ '[[:cntrl:]]' then raise exception 'INVALID_PLACE_CORRECTION'; end if;
 -- One a day for the same member and place (the lock keeps two quick taps from both getting in), and 30 places a day in all.
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':place-correction',0));
 if exists(select 1 from private.place_corrections pc where pc.user_id=uid and pc.city_id=p_city_id and pc.place_key=p_place_key
  and pc.created_at>clock_timestamp()-interval '1 day') then raise exception 'PLACE_CORRECTION_SENT_TODAY'; end if;
 perform private.enforce_rate_limit('place_corrections',30,interval '1 day');
 insert into private.place_corrections(user_id,city_id,place_key,kind,note) values(uid,p_city_id,p_place_key,p_kind,clean);
end $$;

-- 2) 가 봤어요·가 보고 싶어요: the same people get_place_saves counts in saverCount (private.place_savers), split by the 가 봤음
-- mark on the place's saved key, the key get_saved_place_state reads. Numbers only, like saverCount; get_place_saves keeps its shape.
create function public.get_place_save_kinds(p_city_id text,p_place_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare saved text; total integer; been integer;
begin
 if p_city_id is null or p_place_key is null or not exists(select 1 from public.cities c where c.id=p_city_id)
  or not (p_place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or p_place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$') then return null; end if;
 saved:=private.saved_key(private.saved_ref('place',p_place_key,p_city_id));
 select count(*)::integer,(count(*) filter (where exists(select 1 from private.saved_place_been b where b.user_id=s.user_id and b.saved_key=saved)))::integer
  into total,been from private.place_savers(p_city_id,p_place_key) s;
 return jsonb_build_object('beenCount',been,'wantCount',total-been);
end $$;

do $$ declare signature text; begin
 foreach signature in array array['public.report_place_correction(text,text,text,text)','public.get_place_save_kinds(text,text)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.report_place_correction(text,text,text,text) to authenticated;
grant execute on function public.get_place_save_kinds(text,text) to anon,authenticated;

-- An unknown target rejects the whole analytics batch, so these must reach production before the app build.
insert into private.behavior_targets(id) values
  ('places.correction.open'),('places.correction.kind'),('places.correction.submit')
on conflict (id) do nothing;
notify pgrst,'reload schema';
