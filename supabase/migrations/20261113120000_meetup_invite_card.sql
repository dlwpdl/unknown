-- Meetup web invitations and the shop QR landing (owner 2026-11-13).
-- Read-only functions for people who hold a link. No table or column changes, nothing new to delete with an account.
--
-- get_meetup_invite_card(post, code): what an invitation shows beyond the share preview and the guest post read
--   (get_public_post already gives guests the title, host meetup name, schedule, seats, category and ages):
--     intro    the opening of the introduction, through the same contact/link/HTML line filters and 150-character stop as
--              every public opening (private.public_post_opening), with the place and event tails cut off first
--     area     the neighborhood nearest the picked Gling map place (src/lib/neighborhoods.ts, 6 km), never the place
--     fee      the fee amount, which applicants already see before applying
--     inviter  the nickname of the member whose personal invite code is in the link
--   The exact place, the rest of the body, the application question, members and contacts stay in the app.
-- get_business_invite_landing(code): the business behind a shop QR code (its public profile name and city) and its open
--   public meetups held at its own linked map places (private.webshop_place_links). The owner's account is never named.
-- Both read private.business_public_posts, so invite-only meetups and hidden business posts stay out, and both keep the
-- share preview's active-account, block and report checks.

-- The Gling map place a meetup was opened for: the tail written by placeMeetupTail (src/lib/meetup-destination.ts), read
-- with the same rules as splitPlaceMeetupBody (one place tail at the very end, no event link, at most 5,000 characters).
create function private.meetup_place_key(p_body text) returns text
language sql immutable set search_path='' as $$
  select 'osm:'||m[1]||':'||m[2]
  from regexp_match(p_body, '\n\n장소: [^\r\n]{1,250}\n장소 정보: https://www\.openstreetmap\.org/(node|way|relation)/([1-9][0-9]{0,18})$') m
  where char_length(p_body)<=5000 and p_body !~ '(^|\n)행사 ID: '
    and (char_length(p_body)-char_length(replace(p_body,'장소 정보:','')))/char_length('장소 정보:')=1;
$$;

-- shortcut: the open cities' neighborhood centres are copied from src/lib/neighborhoods.ts (scripts/meetup-invite.test.mjs
-- keeps the two lists equal); move both to a table when neighborhoods change outside app releases.
create function private.meetup_invite_area(p_body text, p_city text) returns text
language sql stable security definer set search_path='' as $$
  with pin as (
    select distinct (e->>'latitude')::float8 lat,(e->>'longitude')::float8 lng
    from private.city_place_catalog c
      cross join lateral unnest(array['places','regionalPlaces','extraPlaces','morePlaces']) list
      cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'cities'->p_city->list)='array'
        then c.payload->'cities'->p_city->list else '[]'::jsonb end) e
    where c.id and e->>'id'=private.meetup_place_key(p_body) and e->>'cityId'=p_city
      and jsonb_typeof(e->'latitude')='number' and jsonb_typeof(e->'longitude')='number'
  ), area(city,id,lat,lng) as (values
    ('vancouver','downtown',49.282,-123.12),('vancouver','west-end',49.286,-123.134),
    ('vancouver','yaletown',49.275,-123.122),('vancouver','kitsilano',49.268,-123.168),
    ('vancouver','mount-pleasant',49.263,-123.1),('vancouver','commercial-drive',49.27,-123.07),
    ('vancouver','oakridge',49.233,-123.117),('vancouver','ubc',49.261,-123.246),
    ('vancouver','north-vancouver',49.32,-123.072),('vancouver','west-vancouver',49.328,-123.16),
    ('vancouver','metrotown',49.226,-123.004),('vancouver','brentwood',49.267,-123.001),
    ('vancouver','joyce',49.238,-123.032),('vancouver','edmonds',49.212,-122.959),
    ('vancouver','burquitlam',49.261,-122.89),('vancouver','coquitlam',49.25,-122.85),
    ('vancouver','coquitlam-centre',49.277,-122.8),('vancouver','port-moody',49.284,-122.832),
    ('vancouver','new-westminster',49.206,-122.911),('vancouver','richmond',49.167,-123.134),
    ('vancouver','surrey',49.19,-122.849),('vancouver','langley',49.104,-122.66),('vancouver','delta',49.163,-122.902),
    ('vancouver','ladner',49.089,-123.082),('vancouver','tsawwassen',49.006,-123.083),
    ('vancouver','port-coquitlam',49.262,-122.781),('vancouver','maple-ridge',49.219,-122.598),
    ('vancouver','white-rock',49.025,-122.802),
    ('toronto','downtown',43.651,-79.383),('toronto','koreatown',43.665,-79.418),
    ('toronto','yonge-eglinton',43.706,-79.399),('toronto','north-york',43.768,-79.413),
    ('toronto','finch',43.78,-79.416),('toronto','thornhill',43.815,-79.424),('toronto','richmond-hill',43.883,-79.44),
    ('toronto','vaughan',43.837,-79.508),('toronto','markham',43.856,-79.337),('toronto','scarborough',43.773,-79.258),
    ('toronto','etobicoke',43.621,-79.513),('toronto','mississauga',43.589,-79.644),
    ('montreal','downtown',45.502,-73.567),('montreal','old-montreal',45.508,-73.554),
    ('montreal','plateau',45.523,-73.58),('montreal','mile-end',45.525,-73.6),
    ('montreal','cote-des-neiges',45.496,-73.622),('montreal','ndg',45.473,-73.615),
    ('montreal','westmount',45.485,-73.596),('montreal','verdun',45.458,-73.57),
    ('montreal','saint-laurent',45.51,-73.68),('montreal','laval',45.56,-73.72),('montreal','brossard',45.45,-73.465)
  ), nearest as (
    select a.id,12742*asin(sqrt(power(sin(radians(a.lat-pin.lat)/2),2)
      +cos(radians(pin.lat))*cos(radians(a.lat))*power(sin(radians(a.lng-pin.lng)/2),2))) km
    from pin join area a on a.city=p_city
    -- Two map rows on the same id but different spots: unknown which one, so none.
    where (select count(*) from pin)=1
  )
  select id from nearest where km<=6 order by km,id limit 1;
$$;

create function public.get_meetup_invite_card(p_post_id uuid, p_code text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,
    'memberCount',case when jsonb_typeof(p.room_preview->'memberCount')='number' then p.room_preview->'memberCount' end,
    'capacity',case when jsonb_typeof(p.room_preview->'capacity')='number' then p.room_preview->'capacity' end,
    'fee',case when jsonb_typeof(p.room_preview->'fee'->'amount')='number' then p.room_preview->'fee'->'amount' end,
    'intro',private.public_post_opening(split_part(split_part(coalesce(p.body,''),E'\n\n장소:',1),E'\n\n행사 ID:',1),p.title),
    'area',private.meetup_invite_area(p.body,p.city_id),
    -- No sender name when the code is the host's own or belongs to an operator of the business that posted it:
    -- that would tie the host name or business to a personal account (security review on PR #171).
    'inviter',(select o.nickname from private.invite_links l join public.profiles o on o.id=l.owner_id
      where p_code ~ '^[A-HJ-NP-Z2-9]{8}$' and l.code=p_code and l.merchant_id is null and o.account_status='active'
        and l.owner_id<>p.author_id
        and not exists(select 1 from public.posts x join private.merchant_operators m on m.merchant_id=x.business_author_id
          where x.id=p.id and m.user_id=l.owner_id)
        and not private.is_blocked_between(auth.uid(),o.id) and not private.has_reported(auth.uid(),'user',o.id)))
  from private.business_public_posts p join public.profiles a on a.id=p.author_id
  where p.id=p_post_id and p.status='published' and p.room_preview is not null and a.account_status='active'
    and not private.is_blocked_between(auth.uid(),p.author_id)
    and not private.has_reported(auth.uid(),'post',p.id)
    and not private.has_reported(auth.uid(),'user',p.author_id);
$$;

create function public.get_business_invite_landing(p_code text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('merchantId',l.merchant_id,'name',b.profile->>'name','cityId',b.profile->>'city_id',
    'meetups',coalesce((select jsonb_agg(x.id order by x.created_at desc,x.id) from (
      select p.id,p.created_at from private.business_public_posts p join public.profiles a on a.id=p.author_id
      where p.city_id=b.profile->>'city_id' and private.meetup_is_open(p.status,p.room_preview) and a.account_status='active'
        and not private.is_blocked_between(auth.uid(),p.author_id)
        and not private.has_reported(auth.uid(),'post',p.id)
        and not private.has_reported(auth.uid(),'user',p.author_id)
        and exists(select 1 from private.webshop_place_links w where w.merchant_id=l.merchant_id
          and w.city_id=p.city_id and w.place_key=private.meetup_place_key(p.body))
      order by p.created_at desc,p.id limit 5) x),'[]'::jsonb))
  from private.invite_links l cross join lateral (select public.get_merchant_profile(l.merchant_id) profile) b
  where p_code ~ '^[A-HJ-NP-Z2-9]{8}$' and l.code=p_code and l.merchant_id is not null and b.profile is not null;
$$;

revoke all on function private.meetup_place_key(text),private.meetup_invite_area(text,text),
  public.get_meetup_invite_card(uuid,text),public.get_business_invite_landing(text) from public,anon,authenticated,service_role;
alter function private.meetup_place_key(text) owner to postgres;
alter function private.meetup_invite_area(text,text) owner to postgres;
alter function public.get_meetup_invite_card(uuid,text) owner to postgres;
alter function public.get_business_invite_landing(text) owner to postgres;
grant execute on function public.get_meetup_invite_card(uuid,text),public.get_business_invite_landing(text) to anon,authenticated;
notify pgrst,'reload schema';

-- The invitation, the shop landing and the web apply handoff controls. Additive analytics targets only.
insert into private.behavior_targets(id) values
('invite.web.apply'),('invite.web.other_meetups'),('invite.web.has_app'),('invite.web.no_app'),
('invite.shop.meetup'),('invite.shop.city_meetups'),('invite.shop.open_app'),('meetup.join.open_app')
on conflict do nothing;
