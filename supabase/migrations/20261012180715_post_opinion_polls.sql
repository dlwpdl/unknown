create function private.valid_poll_options(p_options text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(array_ndims(p_options)=1 and array_lower(p_options,1)=1 and cardinality(p_options) between 2 and 6
  and not exists(select 1 from unnest(p_options) v where v is null or char_length(btrim(v)) not between 1 and 80)
  and (select count(distinct btrim(v)) from unnest(p_options) v)=cardinality(p_options),false);
$$;
revoke all on function private.valid_poll_options(text[]) from public,anon,authenticated;

create table public.post_polls (
 post_id uuid primary key references public.posts(id) on delete cascade,
 question text not null check(char_length(btrim(question)) between 1 and 120),
 options text[] not null check(private.valid_poll_options(options)),
 created_at timestamptz not null default now()
);
alter table public.post_polls enable row level security;
revoke all on public.post_polls from public,anon,authenticated;
grant select on public.post_polls to anon,authenticated;
create policy "visible post polls" on public.post_polls for select to anon,authenticated
 using(exists(select 1 from public.get_public_post(post_id)));

create table private.post_poll_votes (
 post_id uuid not null references public.post_polls(post_id) on delete cascade,
 voter_id uuid not null references public.profiles(id) on delete cascade,
 option_index smallint not null check(option_index between 0 and 5),
 created_at timestamptz not null default now(),
 primary key(post_id,voter_id)
);
alter table private.post_poll_votes enable row level security;
revoke all on private.post_poll_votes from public,anon,authenticated;

create function public.get_post_poll(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.post_polls;
begin
 select * into p from public.post_polls where post_id=p_post_id;
 if not found or not exists(select 1 from public.get_public_post(p_post_id)) then return null; end if;
 return jsonb_build_object('post_id',p.post_id,'question',p.question,'options',p.options,
  'counts',array(select (select count(*)::integer from private.post_poll_votes v where v.post_id=p_post_id and v.option_index=n-1)
                 from generate_subscripts(p.options,1) n order by n),
  'my_vote',(select v.option_index from private.post_poll_votes v where v.post_id=p_post_id and v.voter_id=auth.uid()));
end;
$$;
revoke all on function public.get_post_poll(uuid) from public,anon,authenticated;
grant execute on function public.get_post_poll(uuid) to anon,authenticated;

create function public.vote_post_poll(p_post_id uuid,p_option integer,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); choices text[];
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_user_id is distinct from u then raise exception 'AUTH_CHANGED'; end if;
 perform private.assert_active_account(u); perform private.lock_relationships();
 if exists(select 1 from auth.users where id=u and (email like '%@seed.gling.invalid'
   or raw_app_meta_data->'gling_persona'->>'kind'='gling_operated_character')) then raise exception 'OPERATED_PROFILE_CANNOT_VOTE'; end if;
 select options into choices from public.post_polls where post_id=p_post_id for share;
 if not found or not exists(select 1 from public.get_public_post(p_post_id)) then raise exception 'POLL_NOT_FOUND'; end if;
 if p_option is null or p_option<0 or p_option>=cardinality(choices) then raise exception 'INVALID_POLL_OPTION'; end if;
 insert into private.post_poll_votes(post_id,voter_id,option_index) values(p_post_id,u,p_option)
 on conflict(post_id,voter_id) do nothing;
 return public.get_post_poll(p_post_id);
end;
$$;
revoke all on function public.vote_post_poll(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.vote_post_poll(uuid,integer,uuid) to authenticated;

create function public.create_post_with_poll(
 p_city_id text,p_tag_id smallint,p_title text,p_body text,p_hashtags text[],p_image_paths text[],
 p_room_preview jsonb,p_kind text,p_price numeric,p_poll_question text,p_poll_options text[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 if not private.valid_poll_options(p_poll_options) or p_poll_question is null or char_length(btrim(p_poll_question)) not between 1 and 120 then raise exception 'INVALID_POLL'; end if;
 if p_room_preview is not null or p_kind is distinct from 'story' then raise exception 'INVALID_POLL_POST_KIND'; end if;
 saved:=public.create_post(p_city_id,p_tag_id,p_title,p_body,p_hashtags,p_image_paths,p_room_preview,p_kind,p_price);
 insert into public.post_polls(post_id,question,options)
 values(saved,btrim(p_poll_question),array(select btrim(v) from unnest(p_poll_options) with ordinality a(v,n) order by n));
 return saved;
end;
$$;
revoke all on function public.create_post_with_poll(text,smallint,text,text,text[],text[],jsonb,text,numeric,text,text[]) from public,anon,authenticated;
grant execute on function public.create_post_with_poll(text,smallint,text,text,text[],text[],jsonb,text,numeric,text,text[]) to authenticated;
