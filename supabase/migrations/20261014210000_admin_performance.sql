-- First-party product actions; no content, URLs, coordinates or device identifiers.
alter table private.analytics_config add column performance_started_at timestamptz not null default now();
alter table private.behavior_events add column source text check(source in ('unknown','direct','instagram','threads','search','facebook','website'));

create table private.performance_targets (
  kind text not null check(kind in ('event','place')),
  city_id text not null references public.cities(id) on delete cascade,
  target_id text not null check(length(target_id) between 1 and 100),
  name text not null check(length(name) between 1 and 200),
  primary key(kind,city_id,target_id)
);
alter table private.performance_targets owner to postgres;
create index performance_targets_city_idx on private.performance_targets(city_id);
alter table private.performance_targets enable row level security;
revoke all on private.performance_targets from public,anon,authenticated,service_role;

create table private.product_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('notification_push_open','notification_inbox_open','event_view','event_website',
    'place_view','place_directions','place_website','client_error','photo_upload_error','map_error')),
  target_id text not null default '' check(length(target_id)<=100),
  city_id text references public.cities(id) on delete set null,
  platform text not null check(platform in ('ios','android','web')),
  day date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now()
);
alter table private.product_events owner to postgres;
create unique index product_event_daily on private.product_events(user_id,kind,target_id,day,platform)
  where kind not in ('notification_push_open','notification_inbox_open');
-- One notification/source regardless of retries, days or multiple devices.
create unique index product_notification_open on private.product_events(user_id,kind,target_id)
  where kind in ('notification_push_open','notification_inbox_open');
create index product_events_user_time on private.product_events(user_id,created_at);
create index product_events_time on private.product_events(created_at);
alter table private.product_events enable row level security;
revoke all on private.product_events from public,anon,authenticated,service_role;

create function public.record_product_event(p_kind text,p_target_id text,p_city_id text,p_platform text)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); city text; target text:=coalesce(p_target_id,''); label text; notice public.notifications; inserted bigint;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if p_kind is null or p_kind not in ('notification_push_open','notification_inbox_open','event_view','event_website',
      'place_view','place_directions','place_website','client_error','photo_upload_error','map_error')
    or p_platform is null or p_platform not in ('ios','android','web') then raise exception 'INVALID_PRODUCT_EVENT'; end if;
  if exists(select 1 from auth.users u where u.id=uid and (u.email like '%@seed.gling.invalid'
    or u.raw_app_meta_data->>'role'='admin' or u.raw_app_meta_data->'review_access'='true'::jsonb
    or u.raw_app_meta_data->'analytics_internal'='true'::jsonb)) then return false; end if;
  if p_kind in ('notification_push_open','notification_inbox_open') then
    if p_city_id is not null or target !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'INVALID_PRODUCT_EVENT'; end if;
    select n.* into notice from public.notifications n where n.id=target::uuid and n.user_id=uid and private.can_read_notification(n);
    if not found then return false; end if;
    city:=coalesce(notice.city_id,(select p.city_id from public.profiles p where p.id=uid));
  elsif p_kind in ('event_view','event_website') then
    if target !~ '^[A-Za-z0-9_-]{1,100}$' or p_city_id is null then raise exception 'INVALID_PRODUCT_EVENT'; end if;
    select left(btrim(e->>'name'),200) into label from public.ticketmaster_event_cache c
      cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'events')='array' then c.payload->'events'
        when jsonb_typeof(c.payload->'event')='object' then jsonb_build_array(c.payload->'event') else '[]'::jsonb end) e
      join public.cities city on city.id=p_city_id and city.is_open
      where split_part(c.cache_key,':',2)=p_city_id and c.updated_at>now()-interval '24 hours'
        and e->>'id'=target and e->>'country'='CA'
        and regexp_replace(lower(normalize(btrim(e->>'city'),NFD)),U&'[\0300-\036f]','','g')=p_city_id
        and length(btrim(e->>'name'))>0 order by c.updated_at desc limit 1;
    if label is null then raise exception 'EVENT_NOT_FOUND'; end if;
    city:=p_city_id;
    insert into private.performance_targets(kind,city_id,target_id,name) values('event',city,target,label)
      on conflict(kind,city_id,target_id) do update set name=excluded.name;
  elsif p_kind in ('place_view','place_directions','place_website') then
    if target !~ '^osm:(node|way|relation):[0-9]+$' or p_city_id is null then raise exception 'INVALID_PRODUCT_EVENT'; end if;
    if not exists(select 1 from private.performance_targets t join public.cities c on c.id=t.city_id and c.is_open
      where t.kind='place' and t.city_id=p_city_id and t.target_id=target) then raise exception 'PLACE_NOT_FOUND'; end if;
    city:=p_city_id;
  else
    if p_target_id is not null or p_city_id is not null then raise exception 'INVALID_PRODUCT_EVENT'; end if;
    select p.city_id into city from public.profiles p where p.id=uid;
  end if;
  perform private.enforce_rate_limit('product_event',60,interval '1 minute');
  insert into private.product_events(user_id,kind,target_id,city_id,platform) values(uid,p_kind,target,city,p_platform)
    on conflict do nothing returning id into inserted;
  return inserted is not null;
end;
$$;

alter function public.record_product_event(text,text,text,text) owner to postgres;
revoke all on function public.record_product_event(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_product_event(text,text,text,text) to authenticated;

-- Explicit fourth argument keeps old clients' three-argument RPC unambiguous.
create function public.record_behavior_events(p_session text,p_platform text,p_events jsonb,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
  if p_source is null or p_source not in ('unknown','direct','instagram','threads','search','facebook','website') then raise exception 'INVALID_BEHAVIOR'; end if;
  perform public.record_behavior_events(p_session,p_platform,p_events);
  select p.id into uid from public.profiles p where p.id=auth.uid();
  update private.behavior_events e set source=p_source where e.session_id=p_session and e.source is null
    and e.user_id is not distinct from uid and e.seq in (select (x->>'seq')::int from jsonb_array_elements(p_events) x);
end;
$$;
alter function public.record_behavior_events(text,text,jsonb,text) owner to postgres;
revoke all on function public.record_behavior_events(text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.record_behavior_events(text,text,jsonb,text) to anon,authenticated;

-- The shared app emits these fixed screens; preserving writer validation/upsert avoids losing visits.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.record_app_visit(text,text,text)'::regprocedure);
  if strpos(definition,'''post'',''search'',''settings'')')=0 then raise exception 'VISIT_SCREEN_CHECK_CHANGED'; end if;
  definition:=replace(definition,'^[0-9A-Za-z.+_-]{1,32}$','^[0-9A-Za-z.+_()-]{1,32}$');
  execute replace(definition,'''post'',''search'',''settings'')',
    '''post'',''search'',''settings'',''events'',''event-detail'',''places'',''place-detail'',''meetup-create'',''meetup-join'',''meetup-profile'',''meetup-application'',''inbox'',''notification-settings'',''promotions'',''guidelines'')');
  definition:=pg_get_functiondef('public.record_behavior_events(text,text,jsonb)'::regprocedure);
  if strpos(definition,'''events'',''event-detail''')=0 then raise exception 'BEHAVIOR_SCREEN_CHECK_CHANGED'; end if;
  execute replace(definition,'''events'',''event-detail''','''events'',''event-detail'',''places'',''place-detail''');
end;
$$;
insert into private.behavior_targets(id) values
('today.places.open'),('today.places.place-open'),('places.back'),('places.view-more'),
('places.category.all'),('places.category.food'),('places.category.cafe'),('places.category.places'),
('places.open'),('places.list.scroll'),
('places.detail.back'),('places.detail.scroll'),('places.detail.source'),('places.detail.website'),('places.detail.attribution')
on conflict do nothing;

-- Same verified OSM identities as the dated app catalog; these rows are validation data, never popularity.
insert into private.performance_targets(kind,city_id,target_id,name) values
('place','toronto','osm:node:343288369','Anewen Greenbelt'),
('place','toronto','osm:node:42395700','Burger King'),
('place','toronto','osm:node:253818647','Cafe AC'),
('place','toronto','osm:node:245022511','California Sandwiches'),
('place','toronto','osm:node:281665202','Chatime'),
('place','toronto','osm:node:368385388','CN Tower Edge Walk'),
('place','toronto','osm:node:256351459','Colborne Lodge'),
('place','toronto','osm:node:243955827','Cora Pizza'),
('place','toronto','osm:node:368144628','Crawford-Jones Memorial Park'),
('place','toronto','osm:node:260339225','Deco'),
('place','toronto','osm:node:277039070','Don Valley Brick Works'),
('place','toronto','osm:node:249295975','Drom Taberna'),
('place','toronto','osm:node:67344938','Emily Rose Cafe'),
('place','toronto','osm:node:249297585','Four Brothers Pizza'),
('place','toronto','osm:node:280493843','Good Earth Coffeehouse'),
('place','toronto','osm:node:244884014','Harry''s Charbroiled'),
('place','toronto','osm:node:368150111','Humber Arboretum'),
('place','toronto','osm:node:364931637','James Gardens'),
('place','toronto','osm:node:108447516','Lower Don Recreational Trail'),
('place','toronto','osm:node:60796373','Mary Brown''s'),
('place','toronto','osm:node:158712950','McDonald''s'),
('place','toronto','osm:node:42606718','McDonald''s'),
('place','toronto','osm:node:54965526','McDonald''s'),
('place','toronto','osm:node:214312074','Michael Lee-Chin Crystal'),
('place','toronto','osm:node:277040113','Mofer Coffee'),
('place','toronto','osm:node:276474692','Mofer Coffee Front St'),
('place','toronto','osm:node:247134305','Mr. Sub'),
('place','toronto','osm:node:380040879','Museum of Illusions'),
('place','toronto','osm:node:147134453','Newtonbrook Park'),
('place','toronto','osm:node:53542349','Nord Lyon Cafe'),
('place','toronto','osm:node:391175913','Ontario Fire Fighters Memorial'),
('place','toronto','osm:node:243421095','Pi Co.'),
('place','toronto','osm:node:209247596','Pizza Nova'),
('place','toronto','osm:node:156867672','Pizza Pizza'),
('place','toronto','osm:node:158701752','Pizza Pizza'),
('place','toronto','osm:node:62574874','Pizza Pizza'),
('place','toronto','osm:node:279217408','Pontic Greeks'),
('place','toronto','osm:node:67972568','Popeyes'),
('place','toronto','osm:node:137441530','Prague Restaurant'),
('place','toronto','osm:node:243955821','Prime Doner Shwarma'),
('place','toronto','osm:node:281927817','Riverdale Farm'),
('place','toronto','osm:node:364934335','Scarlett Mills Park'),
('place','toronto','osm:node:48553537','Second Cup'),
('place','toronto','osm:node:292767952','Serena Gundy Park'),
('place','toronto','osm:node:385036734','Sheldon''s Lookout'),
('place','toronto','osm:node:276476517','Starbucks'),
('place','toronto','osm:node:60931257','Starbucks'),
('place','toronto','osm:node:118421991','Subway'),
('place','toronto','osm:node:48553513','Subway'),
('place','toronto','osm:node:60930945','Subway'),
('place','toronto','osm:node:67344966','Subway'),
('place','toronto','osm:node:67344518','Tahini''s'),
('place','toronto','osm:node:245020012','The Fourth Man in the Fire Pizzeria'),
('place','toronto','osm:node:324550521','The Governor''s Bridge Lookout'),
('place','toronto','osm:node:176544089','Tim Hortons'),
('place','toronto','osm:node:246694096','Tim Hortons'),
('place','toronto','osm:node:247134293','Tim Hortons'),
('place','toronto','osm:node:253433635','Tim Hortons'),
('place','toronto','osm:node:278103212','Tim Hortons'),
('place','toronto','osm:node:279641656','Tim Hortons'),
('place','toronto','osm:node:280889469','Tim Hortons'),
('place','toronto','osm:node:281664356','Tim Hortons'),
('place','toronto','osm:node:281668247','Tim Hortons'),
('place','toronto','osm:node:54965507','Tim Hortons'),
('place','toronto','osm:node:59566254','Tim Hortons'),
('place','toronto','osm:node:60930953','Tim Hortons'),
('place','toronto','osm:node:79877659','Tim Hortons'),
('place','toronto','osm:node:95378352','Tim Hortons'),
('place','toronto','osm:node:364941864','Ukranian Canadian Memorial Park'),
('place','toronto','osm:node:364941869','Ukranian Canadian Memorial Park memorial'),
('place','toronto','osm:node:364861014','University of Toronto Art Centre'),
('place','toronto','osm:node:364944377','Weston Lions Park'),
('place','toronto','osm:node:299290515','Windfields Park'),
('place','toronto','osm:node:299296632','Windfields Park'),
('place','toronto','osm:node:364925801','Étienne Brûlé Park'),
('place','vancouver','osm:node:648735254','2010 Olympic Cauldron'),
('place','vancouver','osm:node:652955238','Analog Coffee'),
('place','vancouver','osm:node:582801920','Anh And Chi'),
('place','vancouver','osm:node:651057575','Banana Leaf'),
('place','vancouver','osm:node:1111302009','Bau-Xi Gallery'),
('place','vancouver','osm:node:638747935','Blenz Coffee'),
('place','vancouver','osm:node:642902573','Blenz Coffee'),
('place','vancouver','osm:node:729134582','Blenz Coffee'),
('place','vancouver','osm:node:3677464190','Brockton Point'),
('place','vancouver','osm:node:736729137','Bubble World Tea House'),
('place','vancouver','osm:node:582801100','Budgies Burritos'),
('place','vancouver','osm:node:582801711','Caffè Mira'),
('place','vancouver','osm:node:677284036','City of Vancouver Archives'),
('place','vancouver','osm:node:644351081','Denny''s'),
('place','vancouver','osm:node:644342005','East is East'),
('place','vancouver','osm:node:567142934','Elysian Coffee Roasters'),
('place','vancouver','osm:node:1178757953','Empress of Japan Figurehead'),
('place','vancouver','osm:node:644348666','Evelyn''s Coffee and Grill'),
('place','vancouver','osm:node:2327355724','Fellowship Bell'),
('place','vancouver','osm:node:651055563','Flamingo Cafe'),
('place','vancouver','osm:node:644342018','Folke'),
('place','vancouver','osm:node:649986497','Freshslice Pizza'),
('place','vancouver','osm:node:3666684802','G.G. McGeer, K.C.'),
('place','vancouver','osm:node:703754423','Gastown Steam Clock'),
('place','vancouver','osm:node:582799001','Gene Coffee Bar'),
('place','vancouver','osm:node:3666684399','George Vancouver'),
('place','vancouver','osm:node:638861831','Giardino Restaurant'),
('place','vancouver','osm:node:638861822','GO Canada'),
('place','vancouver','osm:node:889550078','Harbour Centre Lookout Tower'),
('place','vancouver','osm:node:2410285536','Hollow Tree'),
('place','vancouver','osm:node:582802371','Hunnybee Bruncheonette'),
('place','vancouver','osm:node:513053838','Ignite Pizzeria'),
('place','vancouver','osm:node:582801421','Ignite Pizzeria'),
('place','vancouver','osm:node:638861823','inBtwn Cafe'),
('place','vancouver','osm:node:3709866079','Japanese Canadian War Memorial'),
('place','vancouver','osm:node:644342008','JJ Bean'),
('place','vancouver','osm:node:3646800225','Landy Bannister ''Miracle Mile'' statue'),
('place','vancouver','osm:node:644351089','Leopold''s Tavern'),
('place','vancouver','osm:node:3677399686','Lord Stanley Statue'),
('place','vancouver','osm:node:335749614','Lost Lagoon Nature House'),
('place','vancouver','osm:node:889757499','Lowden’s Lookout'),
('place','vancouver','osm:node:582801710','Lucia'),
('place','vancouver','osm:node:729122817','Lumiere Cafe'),
('place','vancouver','osm:node:471726482','McDonald''s'),
('place','vancouver','osm:node:518120600','McDonald''s'),
('place','vancouver','osm:node:635894583','McDonald''s'),
('place','vancouver','osm:node:582801326','Melo Patisserie'),
('place','vancouver','osm:node:428217683','Memorial Park Obelisk'),
('place','vancouver','osm:node:878192099','Miniature Railway'),
('place','vancouver','osm:node:582799000','Murmur'),
('place','vancouver','osm:node:338846654','New Amsterdam Cafe'),
('place','vancouver','osm:node:582801947','Nikkyu Japanese Restaurant'),
('place','vancouver','osm:node:1211948156','Nine O''Clock Gun'),
('place','vancouver','osm:node:644341993','Olympia Pizza'),
('place','vancouver','osm:node:705754720','Pallet Coffee Roasters'),
('place','vancouver','osm:node:644348654','Platform 7'),
('place','vancouver','osm:node:3677408841','Robert Burns Statue'),
('place','vancouver','osm:node:649986553','Shogun'),
('place','vancouver','osm:node:1856357128','Siwash Rock Viewpoint'),
('place','vancouver','osm:node:571309050','Starbucks'),
('place','vancouver','osm:node:635890634','Starbucks'),
('place','vancouver','osm:node:638752000','Starbucks'),
('place','vancouver','osm:node:582799005','Sushi Kaido'),
('place','vancouver','osm:node:582800962','Thai Son'),
('place','vancouver','osm:node:582801783','The General Public'),
('place','vancouver','osm:node:505797244','The Waffle Co.'),
('place','vancouver','osm:node:644342020','Thomas Haas Chocolates'),
('place','vancouver','osm:node:704317961','Tim Hortons'),
('place','vancouver','osm:node:582801777','Toshi'),
('place','vancouver','osm:node:3666684801','Vancouver City Hall'),
('place','vancouver','osm:node:2147184803','Vancouver Police Museum'),
('place','vancouver','osm:node:338846665','Victory Square Cenotaph'),
('place','vancouver','osm:node:444150756','Waves Coffee House'),
('place','vancouver','osm:node:638771020','Waves Coffee House'),
('place','vancouver','osm:node:3672622874','Windstorm Damage'),
('place','montreal','osm:node:245512739','3 Brewers'),
('place','montreal','osm:node:301033587','A&W'),
('place','montreal','osm:node:300077245','Americano'),
('place','montreal','osm:node:942874457','Atomic Café'),
('place','montreal','osm:node:446283649','Bar Ganadara'),
('place','montreal','osm:node:291483301','Belvédère Léo-Ayotte'),
('place','montreal','osm:node:882629859','Café Bistro'),
('place','montreal','osm:node:764524151','Café Johnny M'),
('place','montreal','osm:node:810791050','Carmen Felipe'),
('place','montreal','osm:node:454890863','Chez Cora'),
('place','montreal','osm:node:427850303','Chic''n''chic'),
('place','montreal','osm:node:191082576','Chopstix'),
('place','montreal','osm:node:1057471110','Columbus Café & Co'),
('place','montreal','osm:node:237590709','Columbus Café & Co'),
('place','montreal','osm:node:462248724','Columbus Café & Co'),
('place','montreal','osm:node:427850307','Condor'),
('place','montreal','osm:node:459929682','Crémazie'),
('place','montreal','osm:node:427850302','Dagwoods'),
('place','montreal','osm:node:1263357006','FOFA Gallery'),
('place','montreal','osm:node:237584792','Frite Alors!'),
('place','montreal','osm:node:237584794','Frite Alors!'),
('place','montreal','osm:node:237585894','Frite Alors!'),
('place','montreal','osm:node:1278632226','Galerie 2000'),
('place','montreal','osm:node:189770160','GP Restaurant'),
('place','montreal','osm:node:412642014','Green Spot'),
('place','montreal','osm:node:1259419665','Guerre des Boers'),
('place','montreal','osm:node:427850304','Halte Gourmande'),
('place','montreal','osm:node:868479771','Hinnawi Bros'),
('place','montreal','osm:node:936979474','Java u'),
('place','montreal','osm:node:988792368','Java U'),
('place','montreal','osm:node:998748019','Java U'),
('place','montreal','osm:node:864716955','Jean Drapeau'),
('place','montreal','osm:node:462248844','Joseph Xavier Perreault'),
('place','montreal','osm:node:864716944','Jérôme Le Royer de La Dauversière'),
('place','montreal','osm:node:1028949540','King Edward VII'),
('place','montreal','osm:node:895798422','King George VI'),
('place','montreal','osm:node:426003015','La Cage'),
('place','montreal','osm:node:237589460','La Croissanterie Figaro'),
('place','montreal','osm:node:191024149','La Crèmière'),
('place','montreal','osm:node:245512741','Le Garden Room'),
('place','montreal','osm:node:191024164','Le Palais du Chausson et de la Pizza'),
('place','montreal','osm:node:1263357005','Leonard & Bina Ellen Art Gallery'),
('place','montreal','osm:node:1259419992','Lion de Belfort'),
('place','montreal','osm:node:1290834958','Monseigneur Ignace Bourget'),
('place','montreal','osm:node:299872785','Monsieur B'),
('place','montreal','osm:node:213716077','Montreal Museum of Fine Arts'),
('place','montreal','osm:node:1244748261','Montreal Tower Observatory'),
('place','montreal','osm:node:1104523796','Monument aux Patriotes'),
('place','montreal','osm:node:465633306','Monument à Maisonneuve'),
('place','montreal','osm:node:459929786','Monument Émile Nelligan'),
('place','montreal','osm:node:333465990','Musée des ondes Emile Berliner'),
('place','montreal','osm:node:522863914','Méchants pinsons'),
('place','montreal','osm:node:237575895','Noodles Star'),
('place','montreal','osm:node:427850300','Orbite'),
('place','montreal','osm:node:454890862','Pizza Hut'),
('place','montreal','osm:node:191024110','Pizza Roni'),
('place','montreal','osm:node:1178621021','Place des Royaux'),
('place','montreal','osm:node:420041499','Restaurant Guan'),
('place','montreal','osm:node:1259419827','Robbie Burns'),
('place','montreal','osm:node:427850327','Route 67'),
('place','montreal','osm:node:343490371','Schwartz''s'),
('place','montreal','osm:node:425718548','Second Cup'),
('place','montreal','osm:node:934881660','Second Cup'),
('place','montreal','osm:node:427850301','Spirale'),
('place','montreal','osm:node:424780621','St-Hubert'),
('place','montreal','osm:node:391849564','Starbucks'),
('place','montreal','osm:node:458918543','Starbucks'),
('place','montreal','osm:node:497839303','Starbucks'),
('place','montreal','osm:node:420041494','Subway'),
('place','montreal','osm:node:424724186','Tim Hortons'),
('place','montreal','osm:node:468969740','Tim Hortons'),
('place','montreal','osm:node:892659877','Tim Hortons'),
('place','montreal','osm:node:998748014','Tim Hortons'),
('place','montreal','osm:node:486668548','Van Houtte'),
('place','montreal','osm:node:1263357007','VAV Gallery'),
('place','calgary','osm:node:296313306','A&W'),
('place','calgary','osm:node:2284826749','American Woodland Caribou'),
('place','calgary','osm:node:3717556090','Andrew Hamilton Gault (PPCLI)'),
('place','calgary','osm:node:4576671289','BABA''S ART Haus'),
('place','calgary','osm:node:2284800316','Big Horn Sheep'),
('place','calgary','osm:node:294093060','Big T''s BBQ & Smokehouse'),
('place','calgary','osm:node:196695456','Boston Pizza'),
('place','calgary','osm:node:252786197','Boston Pizza'),
('place','calgary','osm:node:296984912','Boston Pizza'),
('place','calgary','osm:node:4257061321','Botanical Gardens of Silver Springs'),
('place','calgary','osm:node:254783528','Carl''s Jr.'),
('place','calgary','osm:node:304845761','Coco'),
('place','calgary','osm:node:777346079','CoCo Fresh Tea & Juice'),
('place','calgary','osm:node:301299595','Coffee Company'),
('place','calgary','osm:node:296312875','Cora''s'),
('place','calgary','osm:node:294092856','Dairy Queen'),
('place','calgary','osm:node:577280929','Devonian Gardens'),
('place','calgary','osm:node:196653124','DQ Grill & Chill'),
('place','calgary','osm:node:254783530','Earls'),
('place','calgary','osm:node:623427724','Friends Cafe'),
('place','calgary','osm:node:296985075','Ginger Beef Bistro House'),
('place','calgary','osm:node:301299604','Good Earth Cafe'),
('place','calgary','osm:node:291960926','Great Taste Chinese'),
('place','calgary','osm:node:2284826751','Grey Wolf'),
('place','calgary','osm:node:330244245','Gus''s Cafe & Pizzeria'),
('place','calgary','osm:node:4947549963','Hanson Square'),
('place','calgary','osm:node:196635243','Harvey''s'),
('place','calgary','osm:node:423730798','Haven House Café'),
('place','calgary','osm:node:91101395','Heritage Park'),
('place','calgary','osm:node:2001673375','Holodomor Monument'),
('place','calgary','osm:node:196660148','Joey''s'),
('place','calgary','osm:node:2774328233','John L. Laurie'),
('place','calgary','osm:node:411900221','Jugo Juice'),
('place','calgary','osm:node:196715426','Juree''s Thai Place'),
('place','calgary','osm:node:256189629','KFC'),
('place','calgary','osm:node:269814366','Lookout'),
('place','calgary','osm:node:3717568268','Lord Strathcona'),
('place','calgary','osm:node:4964922743','Lowland Gorillas'),
('place','calgary','osm:node:4964922753','Mandrills'),
('place','calgary','osm:node:1653369404','Memorial Forest Plaques'),
('place','calgary','osm:node:4630326685','New Brighton Bell tower'),
('place','calgary','osm:node:196691118','Pizza 73'),
('place','calgary','osm:node:3717566981','PPCLI'),
('place','calgary','osm:node:331689261','Rendezvous Cafe'),
('place','calgary','osm:node:4329781919','Rev. George McDougal Memorial'),
('place','calgary','osm:node:2284800317','Rocky Mountain Goat'),
('place','calgary','osm:node:4365625291','Scotsman''s Hill'),
('place','calgary','osm:node:300626099','Seattle''s Best'),
('place','calgary','osm:node:254783529','Starbucks'),
('place','calgary','osm:node:321910754','Starbucks'),
('place','calgary','osm:node:532125240','Starbucks'),
('place','calgary','osm:node:532125477','Starbucks'),
('place','calgary','osm:node:667533420','Starbucks'),
('place','calgary','osm:node:810757162','Starbucks'),
('place','calgary','osm:node:196691123','Subway'),
('place','calgary','osm:node:196692247','Subway'),
('place','calgary','osm:node:296984311','Subway'),
('place','calgary','osm:node:297057296','Sun''s BBQ Restaurant'),
('place','calgary','osm:node:196651505','Sushi Boat'),
('place','calgary','osm:node:4251881872','The big "H"'),
('place','calgary','osm:node:296312881','The Keg'),
('place','calgary','osm:node:575696477','The Second Cup'),
('place','calgary','osm:node:252789855','Tim Hortons'),
('place','calgary','osm:node:252828164','Tim Hortons'),
('place','calgary','osm:node:254088639','Tim Hortons'),
('place','calgary','osm:node:300782724','Tim Hortons'),
('place','calgary','osm:node:301299600','Tim Hortons'),
('place','calgary','osm:node:302751674','Tim Hortons'),
('place','calgary','osm:node:301299599','Tim Hortons Express'),
('place','calgary','osm:node:1874602644','Tom Campbell''s Hill'),
('place','calgary','osm:node:679513132','Waves Coffee House'),
('place','calgary','osm:node:204854745','Wendy''s'),
('place','calgary','osm:node:296501233','Wendy''s'),
('place','calgary','osm:node:2284826754','Whooping Crane'),
('place','calgary','osm:node:2284826753','Wood Bison'),
('place','edmonton','osm:node:304153841','A&W'),
('place','edmonton','osm:node:4726895588','Allard Park'),
('place','edmonton','osm:node:304154064','Awash Ethiopian Restaurant'),
('place','edmonton','osm:node:1968581158','Beverly Memorial Cenotaph'),
('place','edmonton','osm:node:3868190323','Borealis Gallery'),
('place','edmonton','osm:node:317331479','Century Palace Restaurant'),
('place','edmonton','osm:node:565309103','Chuck E. Cheese'),
('place','edmonton','osm:node:4546582741','City Hall Cenotaph'),
('place','edmonton','osm:node:6150504074','Corkscrew'),
('place','edmonton','osm:node:944921445','Crum Coffee Bar'),
('place','edmonton','osm:node:818395207','Da Capo Caffe'),
('place','edmonton','osm:node:317126590','Delicious Pho'),
('place','edmonton','osm:node:317121974','Delux Burger Bar'),
('place','edmonton','osm:node:4726903246','Desrochers Park'),
('place','edmonton','osm:node:3636133577','Dog Park'),
('place','edmonton','osm:node:317331921','Double Greeting Won Ton House'),
('place','edmonton','osm:node:800038338','Dream Tea House'),
('place','edmonton','osm:node:2504395894','Earth Sciences Museum'),
('place','edmonton','osm:node:3599485483','Edmonton Tornado Memorial'),
('place','edmonton','osm:node:560191853','El Rancho'),
('place','edmonton','osm:node:5178746384','Frederick G. Todd Lookout'),
('place','edmonton','osm:node:4263876990','High Level Streetcar - Jasper Plaza'),
('place','edmonton','osm:node:6020541709','HMCS Edmonton Plaza'),
('place','edmonton','osm:node:5262997168','Jagre Ridge Golf Course hole # 15 scenic park area north of pond'),
('place','edmonton','osm:node:317122141','Jeffrey''s Café & Wine Bar'),
('place','edmonton','osm:node:317127134','KFC'),
('place','edmonton','osm:node:909402970','La Dolce Vita'),
('place','edmonton','osm:node:632192116','Legislative Assembly Interpretive Centre'),
('place','edmonton','osm:node:4546582742','Memorial to the Ukrainian Holodomor'),
('place','edmonton','osm:node:317118839','Mikado'),
('place','edmonton','osm:node:565309281','Mikado'),
('place','edmonton','osm:node:471702254','myFRIES'),
('place','edmonton','osm:node:636797000','Nara Hookah Lounge'),
('place','edmonton','osm:node:638176425','Neighbour''s Coffee'),
('place','edmonton','osm:node:4263896991','Neon Sign Museum'),
('place','edmonton','osm:node:6150504076','Nessie''s Revenge'),
('place','edmonton','osm:node:304182024','Nha Trang Vietnamese Restaurant'),
('place','edmonton','osm:node:5764899750','Paisley Rest Park'),
('place','edmonton','osm:node:317126934','Panago'),
('place','edmonton','osm:node:317088495','Pho Hoan Pasteur Fusion Noodle House'),
('place','edmonton','osm:node:304150879','Pizza 73'),
('place','edmonton','osm:node:677234773','Portuguese Bakery'),
('place','edmonton','osm:node:304151355','Quiznos'),
('place','edmonton','osm:node:565309880','Quiznos'),
('place','edmonton','osm:node:304150878','Ricky''s All Day Grill'),
('place','edmonton','osm:node:4531652376','Riverdale Lookout'),
('place','edmonton','osm:node:4498776515','Rosenthal''s Park'),
('place','edmonton','osm:node:5266064566','Royal Canadian Air Force Monument'),
('place','edmonton','osm:node:471717381','Savoy''s South Indian Kitchen North (Clareview)'),
('place','edmonton','osm:node:317119549','Second Cup'),
('place','edmonton','osm:node:585205713','Second Cup'),
('place','edmonton','osm:node:973516730','Second Cup'),
('place','edmonton','osm:node:6150504077','Sky Screamer'),
('place','edmonton','osm:node:304151359','Starbucks'),
('place','edmonton','osm:node:632192132','Starbucks'),
('place','edmonton','osm:node:801838400','Starbucks'),
('place','edmonton','osm:node:909037204','Starbucks'),
('place','edmonton','osm:node:5168269241','Stollery Gallery'),
('place','edmonton','osm:node:304154067','Subway'),
('place','edmonton','osm:node:565310090','Subway'),
('place','edmonton','osm:node:317127137','Taco Bell'),
('place','edmonton','osm:node:884205409','Taiwan Bubble Tea'),
('place','edmonton','osm:node:909346677','Tea Cottage'),
('place','edmonton','osm:node:677232592','The Carrot'),
('place','edmonton','osm:node:317335691','Tim Hortons'),
('place','edmonton','osm:node:347337862','Tim Hortons'),
('place','edmonton','osm:node:632192129','Tim Hortons'),
('place','edmonton','osm:node:651152526','Tim Hortons'),
('place','edmonton','osm:node:705698392','Tim Hortons'),
('place','edmonton','osm:node:765386592','Tim Hortons'),
('place','edmonton','osm:node:944913707','Tim Hortons'),
('place','edmonton','osm:node:6150504078','Twister'),
('place','edmonton','osm:node:317125837','Vi''s for Pies'),
('place','edmonton','osm:node:4224171690','War Memorial'),
('place','edmonton','osm:node:317335758','Wendy''s'),
('place','winnipeg','osm:node:366841182','A&W'),
('place','winnipeg','osm:node:706734784','Applebee''s'),
('place','winnipeg','osm:node:279445480','Bangkok Thai'),
('place','winnipeg','osm:node:1241400395','Battle of Seven Oaks Monument'),
('place','winnipeg','osm:node:826310339','BC10'),
('place','winnipeg','osm:node:826310324','BC11'),
('place','winnipeg','osm:node:826310408','BC9'),
('place','winnipeg','osm:node:739144927','Bellissimo Restaurant and Lounge'),
('place','winnipeg','osm:node:420440504','Bison Viewing Mound'),
('place','winnipeg','osm:node:1354445758','Blaurock Café'),
('place','winnipeg','osm:node:2504499494','British Commonwealth Air Training Plan Memorial'),
('place','winnipeg','osm:node:273563735','Cafe Dario'),
('place','winnipeg','osm:node:1067175773','Candy Cane Lane - Christmas Lights'),
('place','winnipeg','osm:node:1957816301','Carol Shields Memorial Labyrinth'),
('place','winnipeg','osm:node:273564175','Casa Ilocandia'),
('place','winnipeg','osm:node:2504499495','Cenotaph'),
('place','winnipeg','osm:node:603401085','chop Steakhouse and Bar'),
('place','winnipeg','osm:node:858730822','CNR Locomotive 6043'),
('place','winnipeg','osm:node:739145572','Cora''s'),
('place','winnipeg','osm:node:1133390964','Dan''s Cafe & Lounge'),
('place','winnipeg','osm:node:603401078','Denny''s'),
('place','winnipeg','osm:node:587605674','Domino''s'),
('place','winnipeg','osm:node:1191736525','Fire Fighters Museum'),
('place','winnipeg','osm:node:583443646','Flying Pizza'),
('place','winnipeg','osm:node:638868123','Fools & Horses'),
('place','winnipeg','osm:node:1445950290','Fort Garry Horse Monument'),
('place','winnipeg','osm:node:1144004218','Fort Garry Horse Museum & Archives'),
('place','winnipeg','osm:node:1421615690','Gallery 1C03'),
('place','winnipeg','osm:node:1421615680','Good Lands Café'),
('place','winnipeg','osm:node:664944216','Harrisons Coffee Co'),
('place','winnipeg','osm:node:1898554182','Lech Kaczynski Memorial'),
('place','winnipeg','osm:node:343302576','Louis Riel'),
('place','winnipeg','osm:node:1133351466','Macao Imperial Tea Canada - Pembina Branch'),
('place','winnipeg','osm:node:1352894026','Maple Grove Park'),
('place','winnipeg','osm:node:1853618186','Mission of the Sisters of Charity of Montreal “Grey Nuns”'),
('place','winnipeg','osm:node:720899561','Mongo''s Grill'),
('place','winnipeg','osm:node:706738644','Montana''s'),
('place','winnipeg','osm:node:715796797','Moxie''s'),
('place','winnipeg','osm:node:1421615703','Myrnd Café and Catering'),
('place','winnipeg','osm:node:1067175771','Nutcracker Lane - Christmas Lights'),
('place','winnipeg','osm:node:1805702551','Passage Coffee'),
('place','winnipeg','osm:node:1206839262','Plug In Institute of Contemporary Art'),
('place','winnipeg','osm:node:1067175769','Polar Bear Lane - Christmas Lights'),
('place','winnipeg','osm:node:792138086','Prairie Ink'),
('place','winnipeg','osm:node:279692180','Queen Elizabeth II'),
('place','winnipeg','osm:node:1067175775','Reindeer Run - Christmas Lights'),
('place','winnipeg','osm:node:853617593','Robins Donuts'),
('place','winnipeg','osm:node:706741531','Salisbury House'),
('place','winnipeg','osm:node:362602191','Sam''s Place'),
('place','winnipeg','osm:node:538127342','Shwarma Time'),
('place','winnipeg','osm:node:638868132','SMITH Restaurant'),
('place','winnipeg','osm:node:717665510','Smitty''s'),
('place','winnipeg','osm:node:1131897478','Starbucks'),
('place','winnipeg','osm:node:1133049030','Starbucks'),
('place','winnipeg','osm:node:1223886819','Starbucks'),
('place','winnipeg','osm:node:1224869225','Starbucks'),
('place','winnipeg','osm:node:715819004','Starbucks'),
('place','winnipeg','osm:node:764500904','Starbucks'),
('place','winnipeg','osm:node:279445478','Subway'),
('place','winnipeg','osm:node:279460365','Subway'),
('place','winnipeg','osm:node:679391947','Subway'),
('place','winnipeg','osm:node:739144905','Subway'),
('place','winnipeg','osm:node:638868121','The Old Spaghetti Factory'),
('place','winnipeg','osm:node:1133426696','Tim Hortons'),
('place','winnipeg','osm:node:1227198656','Tim Hortons'),
('place','winnipeg','osm:node:1316698337','Tim Hortons'),
('place','winnipeg','osm:node:1613184491','Tim Hortons'),
('place','winnipeg','osm:node:1616917397','Tim Hortons'),
('place','winnipeg','osm:node:610186316','Tim Hortons'),
('place','winnipeg','osm:node:679387095','Tim Hortons'),
('place','winnipeg','osm:node:706739313','Tim Hortons'),
('place','winnipeg','osm:node:273549349','Upper Fort Garry Gateway'),
('place','winnipeg','osm:node:679386533','Wendy''s'),
('place','winnipeg','osm:node:343302468','Winnipeg Railway Museum'),
('place','winnipeg','osm:node:704612372','Wok Box'),
('place','saskatoon','osm:node:2704616820','A&W'),
('place','saskatoon','osm:node:9697092466','All In The Wild Gallery'),
('place','saskatoon','osm:node:5262708672','Anchor for the Saskatchewan Sailor'),
('place','saskatoon','osm:node:4761783030','Art Placement: The Gallery'),
('place','saskatoon','osm:way:4371076','Balsam Park'),
('place','saskatoon','osm:node:13900300322','Black Spruce Gallery'),
('place','saskatoon','osm:node:2704482017','Blue Diamond Restaurant'),
('place','saskatoon','osm:node:1416833940','Broadway Roastery on 8th'),
('place','saskatoon','osm:node:2705665388','Burger King'),
('place','saskatoon','osm:node:4198123589','Cathedral of the Holy Family'),
('place','saskatoon','osm:node:2705660945','Chianti''s Cafe'),
('place','saskatoon','osm:node:2748206723','City Perks'),
('place','saskatoon','osm:node:2747976855','Collective Coffee'),
('place','saskatoon','osm:node:4550086489','D''Lish by Tish Cafe'),
('place','saskatoon','osm:node:12944210538','Denny Carr Statue'),
('place','saskatoon','osm:node:1449137112','Denny''s'),
('place','saskatoon','osm:node:1817789801','Denny''s'),
('place','saskatoon','osm:node:2817039040','Dutch Growers'),
('place','saskatoon','osm:node:12739867420','Five Corners'),
('place','saskatoon','osm:node:2687331371','Fountain'),
('place','saskatoon','osm:node:1416833948','Fuh Station 2'),
('place','saskatoon','osm:node:2704466966','Genesis'),
('place','saskatoon','osm:node:1178753783','Good Earth Coffee House'),
('place','saskatoon','osm:node:9696265510','Gordon Snelgrove Gallery'),
('place','saskatoon','osm:node:2704455973','Granda House'),
('place','saskatoon','osm:node:7838591885','Grave of John G. Diefenbaker (Canada''s 13th Prime Minister)'),
('place','saskatoon','osm:node:2704582160','H67 Donair and Pizza'),
('place','saskatoon','osm:node:9982303665','Historical plaque for Zion Evangelical Lutheran Church'),
('place','saskatoon','osm:node:2624072087','Hudson''s'),
('place','saskatoon','osm:node:4274146299','Kelly''s Kafe'),
('place','saskatoon','osm:node:9805191132','Kenderdine Art Gallery & College Art Galleries'),
('place','saskatoon','osm:node:13811648377','Kyuubi Culture'),
('place','saskatoon','osm:node:9696254734','Louis'' Loft'),
('place','saskatoon','osm:node:4200803400','Lucky Bastards Destillers'),
('place','saskatoon','osm:node:2704616815','Mano''s Restaurant & Lounge'),
('place','saskatoon','osm:node:9697173325','Memorial Library and Art Gallery'),
('place','saskatoon','osm:node:2704830245','Mount Royal Restaurant'),
('place','saskatoon','osm:node:2094241201','Mr. Sub'),
('place','saskatoon','osm:node:9697113058','Museum of Antiquities'),
('place','saskatoon','osm:node:9696265514','Museum of Natural Sciences University of Saskatchewan'),
('place','saskatoon','osm:node:4373010691','Mystic Java'),
('place','saskatoon','osm:node:3009794467','Peturrson''s Ravine'),
('place','saskatoon','osm:node:13011091539','Pioneer Memorial Cairn'),
('place','saskatoon','osm:node:703029565','Pizza 73'),
('place','saskatoon','osm:node:2704485019','Pizza Pirates (pickup only)'),
('place','saskatoon','osm:node:9673905860','Prism Coffee'),
('place','saskatoon','osm:node:2700692567','Red Pepper'),
('place','saskatoon','osm:node:2253144597','Ricky''s'),
('place','saskatoon','osm:node:2094240170','Rock n Rodz Diner'),
('place','saskatoon','osm:node:2253144637','Sardinia'),
('place','saskatoon','osm:node:12924921780','Saskatchewan MADD Monument'),
('place','saskatoon','osm:node:1817789786','Shark Club'),
('place','saskatoon','osm:node:7359392901','Simply Grounded Coffee Gallery'),
('place','saskatoon','osm:node:14184101301','Skyline Lookout'),
('place','saskatoon','osm:node:12763046253','Spirit of Alliance'),
('place','saskatoon','osm:node:4396260790','Starbucks'),
('place','saskatoon','osm:node:5025232523','Starbucks'),
('place','saskatoon','osm:node:5760751892','Starbucks'),
('place','saskatoon','osm:node:703029566','Starbucks'),
('place','saskatoon','osm:node:7333398258','Starbucks'),
('place','saskatoon','osm:node:9696265511','Starbucks'),
('place','saskatoon','osm:node:2706296403','Subway'),
('place','saskatoon','osm:node:2712922743','TasteBuds'),
('place','saskatoon','osm:node:2828091482','The Bowl'),
('place','saskatoon','osm:node:13037704408','The Studio - Keitha McClocklin Art'),
('place','saskatoon','osm:node:2700694412','Thien Vietnamese Resturant'),
('place','saskatoon','osm:node:1178739997','Tim Hortons'),
('place','saskatoon','osm:node:1406269551','Tim Hortons'),
('place','saskatoon','osm:node:2729833443','Tim Hortons'),
('place','saskatoon','osm:node:5760751895','Tim Hortons'),
('place','saskatoon','osm:node:6564150957','Tim Hortons'),
('place','saskatoon','osm:node:9137995282','Tim Hortons'),
('place','saskatoon','osm:node:4374610389','Treats'),
('place','saskatoon','osm:node:1178740472','Wendy''s'),
('place','saskatoon','osm:node:702996899','Wendy''s'),
('place','ottawa','osm:node:671983436','99 VIP Seafood'),
('place','ottawa','osm:node:747184851','Aseer Time'),
('place','ottawa','osm:node:765363825','Baguette Brochette'),
('place','ottawa','osm:node:1020933664','Bank of Canada Museum'),
('place','ottawa','osm:node:588151002','Barrio'),
('place','ottawa','osm:node:765363806','Bridgehead'),
('place','ottawa','osm:node:940315054','Bridgehead'),
('place','ottawa','osm:node:940320797','Bridgehead'),
('place','ottawa','osm:node:941441313','Bridgehead'),
('place','ottawa','osm:node:941443111','Bridgehead'),
('place','ottawa','osm:node:941449475','Bridgehead'),
('place','ottawa','osm:node:941451883','Bridgehead'),
('place','ottawa','osm:node:1676174386','Brigadier Andrew Hamilton Gault'),
('place','ottawa','osm:node:955338405','Byward Market'),
('place','ottawa','osm:node:747539341','Cadena Restaurant & Tap Bar'),
('place','ottawa','osm:node:808467735','Cafe Deluxe'),
('place','ottawa','osm:node:1021349151','Canada Agriculture and Food Museum'),
('place','ottawa','osm:node:2360751878','Canadian Firefighters Memorial'),
('place','ottawa','osm:node:2379199628','Canadian Police Memorial'),
('place','ottawa','osm:node:293294911','Chantal''s Hot Fries'),
('place','ottawa','osm:node:457282818','Claude Chip Wagon'),
('place','ottawa','osm:node:447045908','Cora'),
('place','ottawa','osm:node:1020907559','Cumberland Heritage Village Museum'),
('place','ottawa','osm:node:600126921','Daly''s'),
('place','ottawa','osm:node:2150192956','Deschênes Rapids Lookout'),
('place','ottawa','osm:node:293306462','Diefenbunker'),
('place','ottawa','osm:node:600126931','Dining Hall'),
('place','ottawa','osm:node:600122049','Gabriel Pizza'),
('place','ottawa','osm:node:600101643','Harvey''s'),
('place','ottawa','osm:node:795245165','Holland Cross Food Court'),
('place','ottawa','osm:node:1735093008','Hungarian Monument'),
('place','ottawa','osm:node:588145957','Ideal Coffee'),
('place','ottawa','osm:node:588149748','Istanbul Cultural House Cafe'),
('place','ottawa','osm:node:293565377','JP''s Fries'),
('place','ottawa','osm:node:2088962589','Marsh lookout'),
('place','ottawa','osm:node:775320081','McDonald''s'),
('place','ottawa','osm:node:588151181','Milestones'),
('place','ottawa','osm:node:765363729','Mocha Mirage Café'),
('place','ottawa','osm:node:1674981797','NAK Gallery'),
('place','ottawa','osm:node:1449007333','National Aboriginal Veterans Monument'),
('place','ottawa','osm:node:2379648379','Oscar Peterson'),
('place','ottawa','osm:node:2384611189','Ottawa Fire Fighters'),
('place','ottawa','osm:node:292324492','Parliament Hill'),
('place','ottawa','osm:node:481977248','Penny''s Fudge Factory'),
('place','ottawa','osm:node:1015923922','Pinhey''s Point'),
('place','ottawa','osm:node:600101638','Pizza Pizza'),
('place','ottawa','osm:node:600121720','Pizza Pizza'),
('place','ottawa','osm:node:726928791','Pizza Pizza'),
('place','ottawa','osm:node:765366980','Planet Coffee'),
('place','ottawa','osm:node:1735093018','Rideau Falls'),
('place','ottawa','osm:node:938660537','Second Cup'),
('place','ottawa','osm:node:938691904','Second Cup'),
('place','ottawa','osm:node:941527871','Second Cup'),
('place','ottawa','osm:node:948968729','Second Cup'),
('place','ottawa','osm:node:671852037','Starbucks'),
('place','ottawa','osm:node:686659922','Starbucks'),
('place','ottawa','osm:node:736395952','Starbucks'),
('place','ottawa','osm:node:938691909','Starbucks'),
('place','ottawa','osm:node:1645074777','Stittsville Cenotaph'),
('place','ottawa','osm:node:1772920299','T-33'),
('place','ottawa','osm:node:438892467','Tea Store'),
('place','ottawa','osm:node:2430311342','The Canadian Role in the Defence of Hong Kong'),
('place','ottawa','osm:node:560750193','The Cross Bar Restaurant'),
('place','ottawa','osm:node:765178898','The Dough Bros'),
('place','ottawa','osm:node:765366981','The Haunted Walk of Ottawa'),
('place','ottawa','osm:node:588151003','The King Eddy'),
('place','ottawa','osm:node:778695498','The Porch'),
('place','ottawa','osm:node:736395925','Tim Hortons'),
('place','ottawa','osm:node:747459792','Tim Hortons'),
('place','ottawa','osm:node:876639105','Tim Hortons'),
('place','ottawa','osm:node:1676177213','Tomb of the Unknown Soldier'),
('place','ottawa','osm:node:1658243662','Westboro cenotaph'),
('place','ottawa','osm:node:600127269','Wilfred''s'),
('place','ottawa','osm:node:588178972','Zak''s Diner'),
('place','ottawa','osm:node:600101630','Zak''s Diner'),
('place','regina','osm:node:6577716386','13th Ave Coffee House'),
('place','regina','osm:node:4225900389','Austrian edelweiss pavilion'),
('place','regina','osm:node:2800310746','Birmingham''s Vodka and Ale House'),
('place','regina','osm:node:12136690882','Bliss Bistro'),
('place','regina','osm:node:439911146','Boston Pizza'),
('place','regina','osm:node:4225876290','Brazilian pavilion'),
('place','regina','osm:node:3192427272','Brewed Awakening'),
('place','regina','osm:node:3646376950','Brewed Awakening'),
('place','regina','osm:node:2742484567','Brown''s Social House'),
('place','regina','osm:node:2445317517','Cenotaph in Victoria Park'),
('place','regina','osm:node:8732961156','Chief Payepot'),
('place','regina','osm:node:4240719590','Chỗ Chồng làm'),
('place','regina','osm:node:7176377988','Confucius'),
('place','regina','osm:node:439897891','Copper Kettle'),
('place','regina','osm:node:439897601','Crave Kitchen + Wine Bar'),
('place','regina','osm:node:6495950844','Crème Café And Pâtisserie'),
('place','regina','osm:node:8483068241','CWWG Cross of Sacrifice'),
('place','regina','osm:node:2894767080','Denny''s'),
('place','regina','osm:node:2782459321','Dewdney Gardens'),
('place','regina','osm:node:6040504170','Excalipurr Cat Cafe'),
('place','regina','osm:node:2775580539','Five Guys'),
('place','regina','osm:node:4224873300','Francophone pavilion'),
('place','regina','osm:node:12146508258','Fresh and Sweet'),
('place','regina','osm:node:2764946775','Fuddruckers'),
('place','regina','osm:node:4224873299','German pavilion'),
('place','regina','osm:node:4240613590','Giật dây xe bus'),
('place','regina','osm:node:12162275077','Gong Cha'),
('place','regina','osm:node:4224873302','Greek pavilion'),
('place','regina','osm:node:6573534660','Green Spot Cafe'),
('place','regina','osm:node:11540449268','Holodomor Statue'),
('place','regina','osm:node:1955019717','Houston Pizza'),
('place','regina','osm:node:4224882194','Irish pavilion'),
('place','regina','osm:node:4225860091','Italian pavilion'),
('place','regina','osm:node:2577392484','Kooko''s Pizza'),
('place','regina','osm:node:4224873301','Kyiv Ukrainian pavilion'),
('place','regina','osm:node:7176377989','Mahatma Gandhi'),
('place','regina','osm:node:5891985167','Marokena'),
('place','regina','osm:node:6403173765','Naked Bean'),
('place','regina','osm:node:1740875290','Nicky''s Cafe'),
('place','regina','osm:node:2761717562','Panago'),
('place','regina','osm:node:4224939492','Philippine pavilion'),
('place','regina','osm:node:2782459324','Polar Palace Ice Cream'),
('place','regina','osm:node:1740889082','Pump Jack''s Cathedral Saloon and Steakhouse'),
('place','regina','osm:node:2782459319','Regent Pizza'),
('place','regina','osm:node:435595819','Regina Rugby Union Club House'),
('place','regina','osm:node:2764764423','Rock Creek'),
('place','regina','osm:node:5114212127','Saskatchewan Sports Hall of Fame'),
('place','regina','osm:node:2748061666','Saskatchewan War Memorial'),
('place','regina','osm:node:6725585798','Second Cup'),
('place','regina','osm:node:8313333945','Second Cup'),
('place','regina','osm:node:439910184','Smitty''s'),
('place','regina','osm:node:12050425263','So Tealicious!'),
('place','regina','osm:node:2748061681','Spruce Island Overlook'),
('place','regina','osm:node:5891985166','Starbucks'),
('place','regina','osm:node:6848874067','Starbucks'),
('place','regina','osm:node:6900476576','Starbucks'),
('place','regina','osm:node:847186673','Statue of Queen Elizabeth II riding Burmese'),
('place','regina','osm:node:2757178938','Stone''s Throw Coffee House'),
('place','regina','osm:node:2757178933','Subway'),
('place','regina','osm:node:9625269782','Tangerine'),
('place','regina','osm:node:10951717008','The Everyday Kitchen'),
('place','regina','osm:node:439910829','The French Press'),
('place','regina','osm:node:2757178956','The Pita Pit'),
('place','regina','osm:node:11252023672','Tim Hortons'),
('place','regina','osm:node:1740887563','Tim Hortons'),
('place','regina','osm:node:5114183923','Tim Hortons'),
('place','regina','osm:node:7266803285','Tim Hortons'),
('place','regina','osm:node:2759498782','Trafalgar Overlook'),
('place','regina','osm:node:2757178943','Trifon''s Family Restaurant'),
('place','regina','osm:node:436194601','Viet Thai'),
('place','regina','osm:node:3299550111','Wascana Hill'),
('place','regina','osm:node:2581462642','West Side Pizza Family Restaurant'),
('place','regina','osm:node:2782459323','Western Pizza'),
('place','regina','osm:node:2745408836','Willow Island Overlook'),
('place','regina','osm:node:8589940583','Willow Island Overlook'),
('place','saint-john','osm:node:1893975885','A&W'),
('place','saint-john','osm:node:1893967156','Amritsari Flames'),
('place','saint-john','osm:node:7072294695','Anchor'),
('place','saint-john','osm:node:1867369736','Billy''s Seafood Company'),
('place','saint-john','osm:node:1999189411','Charles L. Gorman Monument'),
('place','saint-john','osm:node:5799126290','Cobalt Art Gallery'),
('place','saint-john','osm:node:6698157764','Coffee Mill'),
('place','saint-john','osm:node:1894639814','Cora'),
('place','saint-john','osm:node:1893975889','Deluxe Fish & Chips'),
('place','saint-john','osm:node:1894639821','Domino''s'),
('place','saint-john','osm:node:1893975888','DQ Grill & Chill'),
('place','saint-john','osm:node:1867466427','Founding of New Brunswick'),
('place','saint-john','osm:node:1893967149','Griffin''s Smokehouse'),
('place','saint-john','osm:node:1894639923','Harvey''s'),
('place','saint-john','osm:node:1894639949','Jade City'),
('place','saint-john','osm:node:1867466128','Java Moose'),
('place','saint-john','osm:node:1893972332','Java Moose'),
('place','saint-john','osm:node:1961419476','Java Moose'),
('place','saint-john','osm:node:1867369780','Lemongrass Thai Fare'),
('place','saint-john','osm:node:1867466400','Lest We Forget'),
('place','saint-john','osm:node:1869399088','Lily''s'),
('place','saint-john','osm:node:1890742903','Maple Leaf Queen''s Buffet'),
('place','saint-john','osm:node:1780004808','Mashawi Zein'),
('place','saint-john','osm:node:1893967152','McDonald''s'),
('place','saint-john','osm:node:1893972336','Mother Nature''s'),
('place','saint-john','osm:node:777468790','New Brunswick Museum'),
('place','saint-john','osm:node:1893975893','Pizza Delight'),
('place','saint-john','osm:node:1201111529','Reversing Falls Lookout'),
('place','saint-john','osm:node:2095278482','Sagratis'),
('place','saint-john','osm:node:1999189512','Saint John Firefighters'),
('place','saint-john','osm:node:1867466143','Samuel de Champlain'),
('place','saint-john','osm:node:1867369813','Sense of Tokyo'),
('place','saint-john','osm:node:1893972340','Siler Wok'),
('place','saint-john','osm:node:10711828120','Starbucks'),
('place','saint-john','osm:node:4996287059','Starbucks'),
('place','saint-john','osm:node:778245441','Steamers Lobster Co.'),
('place','saint-john','osm:node:1867466130','Subway'),
('place','saint-john','osm:node:1893975897','Subway'),
('place','saint-john','osm:node:731385666','Subway'),
('place','saint-john','osm:node:1893975898','Taste of Mediterranean'),
('place','saint-john','osm:node:2095332772','The Wild Carrot Cafe'),
('place','saint-john','osm:node:1748084731','Three Sisters Light'),
('place','saint-john','osm:node:1867466385','Tilley Memorial'),
('place','saint-john','osm:node:1780004492','Tim Hortons'),
('place','saint-john','osm:node:1867466140','Tim Hortons'),
('place','saint-john','osm:node:1893972342','Tim Hortons'),
('place','saint-john','osm:node:2084055655','Tim Hortons'),
('place','saint-john','osm:node:2084957317','Tim Hortons'),
('place','saint-john','osm:node:3865644750','Tim Hortons'),
('place','saint-john','osm:node:731385687','Tim Hortons'),
('place','saint-john','osm:node:8962331207','Tim Hortons'),
('place','saint-john','osm:node:9917504694','Tim Hortons'),
('place','saint-john','osm:way:134572075','Tim Hortons'),
('place','saint-john','osm:way:163010781','Tim Hortons'),
('place','saint-john','osm:way:163019583','Tim Hortons'),
('place','saint-john','osm:way:163037016','Tim Hortons'),
('place','saint-john','osm:way:163527961','Tim Hortons'),
('place','saint-john','osm:way:167146425','Tim Hortons'),
('place','saint-john','osm:way:178729541','Tim Hortons'),
('place','saint-john','osm:node:1867369793','Tops Pizza'),
('place','saint-john','osm:node:5740000560','Trinity Cross'),
('place','halifax','osm:node:30899821','Arirang'),
('place','halifax','osm:node:2405084369','Army Museum'),
('place','halifax','osm:node:37132635','ASAP Mabuhay'),
('place','halifax','osm:node:267592735','Bluenose II'),
('place','halifax','osm:node:4498563922','Bonaventure Anchor Memorial'),
('place','halifax','osm:node:475876899','Cafe Ristretto'),
('place','halifax','osm:node:3610854943','Cambridge Battery (historic)'),
('place','halifax','osm:node:30825944','Canton Garden'),
('place','halifax','osm:node:33117712','Dilly Dally Coffee Cafe'),
('place','halifax','osm:node:850115195','Dingle Tower'),
('place','halifax','osm:node:4839118321','Discovery Centre'),
('place','halifax','osm:node:2914347287','Fox Lake Look-off'),
('place','halifax','osm:node:33117714','Freeman''s Lil New York'),
('place','halifax','osm:node:33078684','Freshly Squeezed'),
('place','halifax','osm:node:26286237','Garrison Grounds'),
('place','halifax','osm:node:850025611','Georges Island National Historic Site'),
('place','halifax','osm:node:773014435','Halifax Brewery Farmers Market'),
('place','halifax','osm:node:2405080737','Halifax Citadel Coffee Bar'),
('place','halifax','osm:node:26286235','Halifax Citadel National Historic Site'),
('place','halifax','osm:node:3610854940','Halifax Memorial'),
('place','halifax','osm:node:4422934789','Halifax Public Gardens'),
('place','halifax','osm:node:962125376','Halifax Town Clock'),
('place','halifax','osm:node:33117708','Heartwood Bakery and Cafe'),
('place','halifax','osm:node:32335614','House of Mei Mei'),
('place','halifax','osm:node:37132629','I Love Sushi'),
('place','halifax','osm:node:2624365747','Jane''s Next Door'),
('place','halifax','osm:node:2624400763','Java Blend'),
('place','halifax','osm:node:30915299','Jessy''s Pizza'),
('place','halifax','osm:node:32335616','Jim''s Family Restaurant'),
('place','halifax','osm:node:3799804472','Lighthouse Gallery'),
('place','halifax','osm:node:37132565','Lot Six Bar & Restaurant'),
('place','halifax','osm:node:33078674','McDonald''s'),
('place','halifax','osm:node:4424216190','Mount Olivet Cemetery'),
('place','halifax','osm:node:472067793','Mr. Chang''s Chinese Food Emporium'),
('place','halifax','osm:node:2611276563','Narrow Espresso'),
('place','halifax','osm:node:37132515','Niche Supper Club Lounge'),
('place','halifax','osm:node:32335613','Pizza Tomaso'),
('place','halifax','osm:node:37132554','Press Gang'),
('place','halifax','osm:node:475876993','Ristorante Amano'),
('place','halifax','osm:node:4053538873','Robbie Burns Monument'),
('place','halifax','osm:node:773395898','Rooms Coffee'),
('place','halifax','osm:node:5220574821','Royal Regiment of Canadian Artillery'),
('place','halifax','osm:node:37132718','Rudy''s'),
('place','halifax','osm:node:475877047','Sea Smoke'),
('place','halifax','osm:node:3792152357','Second Gallery'),
('place','halifax','osm:node:5220530521','Shakespeare by the Sea – Office'),
('place','halifax','osm:node:5157406534','Ships and Men'),
('place','halifax','osm:node:2624375974','Slow Mornings Café & Restaurant'),
('place','halifax','osm:node:30945183','Smitty''s'),
('place','halifax','osm:node:5149987722','St.Mary''s Boat Club Upper Deck'),
('place','halifax','osm:node:33117717','Staff of Life Bakery and Cafe'),
('place','halifax','osm:node:1672879768','Starbucks'),
('place','halifax','osm:node:1748435000','Starbucks'),
('place','halifax','osm:node:2702731868','Starbucks'),
('place','halifax','osm:node:2712744153','Starbucks'),
('place','halifax','osm:node:1836752911','Steve-o-Renos'),
('place','halifax','osm:node:33078704','Subway'),
('place','halifax','osm:node:30945181','Swiss Chalet'),
('place','halifax','osm:node:37132701','Taipan Express'),
('place','halifax','osm:node:267592027','The Black Sheep'),
('place','halifax','osm:node:5223795823','The Last Steps'),
('place','halifax','osm:node:3789235357','The Prow Gallery'),
('place','halifax','osm:node:3799765457','The Puffin Gallery'),
('place','halifax','osm:node:2712637926','Tim Hortons'),
('place','halifax','osm:node:2712689446','Tim Hortons'),
('place','halifax','osm:node:2737126855','Tim Hortons'),
('place','halifax','osm:node:31794073','Tim Hortons'),
('place','halifax','osm:node:32335618','Tim Hortons'),
('place','halifax','osm:node:33117796','Tim Hortons'),
('place','halifax','osm:node:761848503','Tim Hortons'),
('place','halifax','osm:node:4953978124','Titanic Victims Cemetary'),
('place','halifax','osm:node:886747513','Trident Booksellers and Cafe'),
('place','halifax','osm:node:33117793','Wasabi House'),
('place','halifax','osm:node:475876928','Wired Monk'),
('place','halifax','osm:node:37132707','World Tea House');

create function public.get_admin_performance(p_days integer default 30,p_city text default null,p_tier text default 'all',
  p_include_internal boolean default false,p_platform text default 'all')
returns jsonb language plpgsql security definer set search_path='' as $$
declare since timestamptz; today date:=(now() at time zone 'UTC')::date; started timestamptz; prepared timestamptz;
  click_started timestamptz; source_started timestamptz; discovery_started timestamptz; error_started timestamptz; delivery_since timestamptz; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_days is null or p_days not in (7,30,90) or p_tier is null or p_tier not in ('all','free','plus','pro','premium')
    or p_include_internal is null or p_platform is null or p_platform not in ('all','ios','android','web')
    or (p_city is not null and not exists(select 1 from public.cities where id=p_city)) then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  since:=(today-(p_days-1))::timestamp at time zone 'UTC';
  select c.started_at,c.performance_started_at into started,prepared from private.analytics_config c;
  select min(e.created_at) filter(where e.kind in ('notification_push_open','notification_inbox_open')),
    min(e.created_at) filter(where e.kind in ('event_view','event_website','place_view','place_directions','place_website')),
    min(e.created_at) filter(where e.kind in ('client_error','photo_upload_error','map_error'))
    into click_started,discovery_started,error_started from private.product_events e;
  select min(e.created_at) into source_started from private.behavior_events e where e.source is not null;
  delivery_since:=greatest(since,now()-interval '7 days');
  perform public.log_admin_access('analytics');
  with population as materialized (
    select p.id,p.city_id,p.created_at,(private.membership_details(p.id)->>'tier') tier,
      (coalesce(u.email like '%@seed.gling.invalid',false) or coalesce(u.raw_app_meta_data->>'role'='admin',false)
        or coalesce(u.raw_app_meta_data->'review_access'='true'::jsonb,false)
        or coalesce(u.raw_app_meta_data->'analytics_internal'='true'::jsonb,false)) internal
    from public.profiles p join auth.users u on u.id=p.id where p.account_status<>'deleted'
  ), eligible as materialized (
    select * from population where (p_include_internal or not internal) and (p_tier='all' or tier=p_tier)
  ), members as materialized (
    select * from eligible where p_city is null or city_id=p_city
  ), visits as materialized (
    select v.* from private.analytics_visits v join members m on m.id=v.user_id
      where v.first_at>=least(since,(today-29)::timestamp at time zone 'UTC') and v.first_at<=now()
        and (p_platform='all' or v.platform=p_platform)
  ), behavior as materialized (
    select e.* from private.behavior_events e left join members m on m.id=e.user_id
      where e.created_at>=since and e.created_at<=now() and (p_platform='all' or e.platform=p_platform)
        and (m.id is not null or (e.user_id is null and p_city is null and p_tier='all'))
  ), product as materialized (
    select e.* from private.product_events e join eligible m on m.id=e.user_id
      where e.created_at>=since and e.created_at<=now() and (p_city is null or
        case when e.kind in ('event_view','event_website','place_view','place_directions','place_website') then e.city_id else m.city_id end=p_city)
        and (p_platform='all' or e.platform=p_platform)
  ), posts as materialized (
    select p.* from public.posts p join members m on m.id=p.author_id
      where p.created_at>=since and p.created_at<=now() and p.status='published' and (p_city is null or p.city_id=p_city)
  ), comments as materialized (
    select c.* from public.comments c join members m on m.id=c.author_id join public.posts p on p.id=c.post_id
      where c.created_at>=since and c.created_at<=now() and c.deleted_at is null and p.status='published' and (p_city is null or p.city_id=p_city)
  ), requests as materialized (
    select r.* from public.meetup_requests r join members m on m.id=r.requester_id
      join public.posts p on p.id=r.post_id where r.created_at>=since and r.created_at<=now() and (p_city is null or p.city_id=p_city)
  ), cohort_stats as materialized (
    select (m.created_at at time zone 'UTC')::date as day,lag.days,count(*) joined,
      count(*) filter(where (m.created_at at time zone 'UTC')::date+lag.days<today) eligible,
      count(*) filter(where (m.created_at at time zone 'UTC')::date+lag.days>=today) pending,
      count(*) filter(where (m.created_at at time zone 'UTC')::date+lag.days<today and exists(
        select 1 from visits v where v.user_id=m.id and (v.first_at at time zone 'UTC')::date=(m.created_at at time zone 'UTC')::date+lag.days)) returned
    from members m cross join (values(1),(7),(30)) lag(days)
    where m.created_at>=greatest(since,started) and m.created_at<=now() group by 1,lag.days
  ), cohort_rows as materialized (
    select day,days,joined,eligible,returned,pending,round(100*returned::numeric/nullif(eligible,0),1) rate from cohort_stats
  ), tracking as materialized (
    select user_id,min(created_at) started_at from (
      select e.user_id,e.created_at from private.behavior_events e join members m on m.id=e.user_id where e.source is not null
      union all select e.user_id,e.created_at from private.product_events e join members m on m.id=e.user_id
    ) x group by user_id
  ), notified as materialized (
    select n.* from public.notifications n join members m on m.id=n.user_id where n.created_at>=since and n.created_at<=now()
  ), delivery as materialized (
    select q.notification_id,bool_or(q.status='provider_accepted') accepted,bool_and(q.status='failed') failed
    from private.push_delivery_queue q join notified n on n.id=q.notification_id
      where q.created_at>=delivery_since
      group by q.notification_id
  ), opens as materialized (
    select e.* from product e join notified n on n.id::text=e.target_id and n.user_id=e.user_id
      where e.kind in ('notification_push_open','notification_inbox_open')
  ), campaign as materialized (
    select n.kind,count(*) generated,
      count(*) filter(where d.accepted) "providerAccepted",count(*) filter(where d.failed and not d.accepted) failed,
      case when click_started is not null then count(*) filter(where exists(select 1 from opens e where e.target_id=n.id::text and e.kind='notification_push_open')) end "pushOpens",
      case when click_started is not null then count(*) filter(where exists(select 1 from opens e where e.target_id=n.id::text and e.kind='notification_inbox_open')) end "inboxOpens",
      case when click_started is not null and p_platform='all' then round(100*(count(*) filter(where d.accepted and t.started_at is not null and n.created_at>=greatest(delivery_since,t.started_at)
        and exists(select 1 from opens e where e.target_id=n.id::text and e.kind='notification_push_open')))::numeric /
        nullif(count(*) filter(where d.accepted and t.started_at is not null and n.created_at>=greatest(delivery_since,t.started_at)),0),1) end "clickRate"
    from notified n left join delivery d on d.notification_id=n.id left join tracking t on t.user_id=n.user_id group by n.kind
  ), payments as materialized (
    select e.* from private.payment_events e join members m on m.id=e.user_id where e.occurred_at>=since and e.occurred_at<=now()
      and e.environment='PRODUCTION' and e.store in ('APP_STORE','PLAY_STORE')
      -- Match the verified general receipt families in functions/_shared/membership.ts.
      and ((e.store='APP_STORE' and e.product_id ~ '^com[.]dlwpdl[.]gling[.]((plus|premium)[.](monthly|yearly)|general[.](plus|pro|premium)[.]monthly[.]v2)$')
        or (e.store='PLAY_STORE' and e.product_id ~ '^gling_((plus|premium):(monthly|yearly)|general_(plus|pro|premium)_v2:monthly)$'))
  ), purchases as materialized (
    select distinct on(store,transaction_id) * from payments where event_type in ('INITIAL_PURCHASE','RENEWAL','NON_RENEWING_PURCHASE')
      and transaction_id is not null and currency is not null and amount>0 order by store,transaction_id,occurred_at,id
  ) select jsonb_build_object(
    'generatedAt',now(),'periodStart',since,'collectionStartedAt',started,'trackingAvailableAt',prepared,
    'activity',jsonb_build_object(
      'dau',(select count(distinct user_id) from visits where (first_at at time zone 'UTC')::date=today),
      'wau',(select count(distinct user_id) from visits where (first_at at time zone 'UTC')::date>=today-6),
      'mau',(select count(distinct user_id) from visits where (first_at at time zone 'UTC')::date>=today-29),
      'activeUsers',(select count(distinct user_id) from visits where first_at>=since),
      'visits',(select count(*) from visits where first_at>=since),
      'visitsPerUser',(select round(count(*)::numeric/nullif(count(distinct user_id),0),1) from visits where first_at>=since),
      'daily',(select coalesce(jsonb_agg(jsonb_build_object('day',d.day,
        'users',case when d.day>= (started at time zone 'UTC')::date then (select count(distinct user_id) from visits where (first_at at time zone 'UTC')::date=d.day) end,
        'visits',case when d.day>= (started at time zone 'UTC')::date then (select count(*) from visits where (first_at at time zone 'UTC')::date=d.day) end,
        'signups',(select count(*) from members where (created_at at time zone 'UTC')::date=d.day)) order by d.day),'[]')
        from (select generate_series((since at time zone 'UTC')::date,today,interval '1 day')::date as day) d),
      'platforms',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select platform,count(distinct user_id) users,count(*) visits from visits where first_at>=since group by platform order by platform)x)),
    'growth',jsonb_build_object('newMembers',(select count(*) from members where created_at>=since),
      'activatedMembers',(select count(*) from members m where m.created_at>=since and (
        exists(select 1 from posts p where p.author_id=m.id) or exists(select 1 from comments c where c.author_id=m.id)
        or exists(select 1 from requests r where r.requester_id=m.id)
        or exists(select 1 from public.messages msg where msg.sender_id=m.id and msg.created_at>=greatest(m.created_at,since) and msg.deleted_at is null))),
      'activationRate',(select round(100*count(*) filter(where exists(select 1 from posts p where p.author_id=m.id)
        or exists(select 1 from comments c where c.author_id=m.id) or exists(select 1 from requests r where r.requester_id=m.id)
        or exists(select 1 from public.messages msg where msg.sender_id=m.id and msg.created_at>=greatest(m.created_at,since) and msg.deleted_at is null))::numeric /
        nullif(count(*),0),1) from members m where m.created_at>=since),
      'sourceStartedAt',source_started,
      'sources',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select source,count(distinct session_id) sessions,
        count(distinct session_id) filter(where kind='success' and target='signup_complete') "signupSessions",
        round(100*(count(distinct session_id) filter(where kind='success' and target='signup_complete'))::numeric/nullif(count(distinct session_id),0),1) "signupRate"
        from behavior where source is not null group by source order by sessions desc)x),
      'onboarding',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select target,count(distinct session_id) sessions,count(distinct user_id) members
        from behavior where kind='success' and target in ('signup_complete','consent_complete','meetup_request_complete') group by target order by target)x)),
    'retention',(select jsonb_agg(jsonb_build_object('days',lag.days,'eligible',coalesce(x.eligible,0),'returned',coalesce(x.returned,0),
      'pending',coalesce(x.pending,0),'rate',round(100*x.returned::numeric/nullif(x.eligible,0),1)) order by lag.days)
      from (values(1),(7),(30)) lag(days) left join (select days,sum(eligible) eligible,sum(returned) returned,sum(pending) pending from cohort_stats group by days)x on x.days=lag.days),
    'cohorts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.day desc),'[]') from (
      select day,max(joined) joined,jsonb_agg(to_jsonb(r)-'day'-'joined' order by days) retention from cohort_rows r group by day)x),
    'community',jsonb_build_object('posts',(select count(*) from posts),'authors',(select count(distinct author_id) from posts),
      'comments',(select count(*) from comments),'commenters',(select count(distinct author_id) from comments),
      'meetupRequests',(select count(*) from requests),'approvedRequests',(select count(*) from requests where status='approved'),
      'mutualConversations',(select count(*) from (select c.id from public.conversations c
        join public.messages msg on msg.conversation_id=c.id join population a on a.id=c.user_low_id join population b on b.id=c.user_high_id
        where c.kind='direct' and (p_include_internal or (not a.internal and not b.internal))
          and exists(select 1 from members m where m.id in (c.user_low_id,c.user_high_id))
          and msg.sender_id in(c.user_low_id,c.user_high_id) and msg.created_at>=since and msg.created_at<=now() and msg.deleted_at is null and msg.hidden_at is null
        group by c.id having count(distinct msg.sender_id)=2)x),
      'savedPosts',(select count(*) from public.post_reactions r join members m on m.id=r.user_id join public.posts p on p.id=r.post_id
        where r.kind='save' and r.created_at>=since and p.status='published' and (p_city is null or p.city_id=p_city)),
      'sharedPosts',(select count(*) from public.post_shares r join members m on m.id=r.user_id join public.posts p on p.id=r.post_id
        where r.created_at>=since and p.status='published' and (p_city is null or p.city_id=p_city))),
    'discovery',jsonb_build_object('startedAt',discovery_started,
      'legacyEventViews',case when p_platform='all' and p_city is null then (select count(*) from private.ticketmaster_event_clicks c join members m on m.id=c.user_id where c.created_at>=since) end,
      'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select t.kind,t.city_id "cityId",t.target_id "targetId",t.name title,
        count(*) filter(where e.kind in ('event_view','place_view')) views,count(*) filter(where e.kind='place_directions') directions,
        count(*) filter(where e.kind in ('event_website','place_website')) websites
        from product e join private.performance_targets t on t.kind=split_part(e.kind,'_',1) and t.city_id=e.city_id and t.target_id=e.target_id
        group by t.kind,t.city_id,t.target_id,t.name order by views desc,websites desc,t.name limit 25)x),
      'eventSaves',null,'eventShares',null,'placeSaves',null,'placeShares',null),
    'notifications',jsonb_build_object('clickStartedAt',click_started,'deliverySince',delivery_since,
      'generated',(select count(*) from notified),'providerAccepted',(select count(*) from delivery where accepted),
      'failed',(select count(*) from delivery where failed and not accepted),
      'pushOpens',case when click_started is not null then (select count(*) from opens where kind='notification_push_open') end,
      'inboxOpens',case when click_started is not null then (select count(*) from opens where kind='notification_inbox_open') end,
      'clickRate',case when click_started is not null and p_platform='all' then (select round(100*count(*) filter(where exists(
        select 1 from opens e where e.target_id=n.id::text and e.kind='notification_push_open'))::numeric/nullif(count(*),0),1)
        from notified n join delivery d on d.notification_id=n.id and d.accepted join tracking t on t.user_id=n.user_id
        where n.created_at>=greatest(delivery_since,t.started_at)) end,
      'activeAfterOpen',case when click_started is not null then (select count(distinct e.user_id) from opens e where
        exists(select 1 from public.posts p where p.author_id=e.user_id and p.created_at between e.created_at and e.created_at+interval '30 minutes' and p.status='published')
        or exists(select 1 from public.comments c where c.author_id=e.user_id and c.created_at between e.created_at and e.created_at+interval '30 minutes' and c.deleted_at is null)
        or exists(select 1 from public.meetup_requests r where r.requester_id=e.user_id and r.created_at between e.created_at and e.created_at+interval '30 minutes')
        or exists(select 1 from public.messages m where m.sender_id=e.user_id and m.created_at between e.created_at and e.created_at+interval '30 minutes' and m.deleted_at is null)) end,
      'optedInMembers',(select count(*) from public.notification_preferences pref join members m on m.id=pref.user_id where pref.push_enabled),
      'preferenceMembers',(select count(*) from public.notification_preferences pref join members m on m.id=pref.user_id),
      'rows',(select coalesce(jsonb_agg(to_jsonb(campaign) order by generated desc),'[]') from campaign)),
    'revenue',jsonb_build_object('paidMembers',(select count(*) from members where tier<>'free'),
      'paidConversion',(select round(100*count(*) filter(where exists(select 1 from purchases p where p.user_id=m.id and p.event_type='INITIAL_PURCHASE'))::numeric/nullif(count(*),0),1) from members m where m.created_at>=since),
      'renewals',(select count(*) from purchases where event_type='RENEWAL'),
      'cancellations',(select count(*) from payments where event_type='CANCELLATION'),'refunds',null,'settlement',null,
      'currencies',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select currency,sum(amount) amount,count(*) purchases,count(distinct user_id) buyers,
        count(*) filter(where event_type='RENEWAL') renewals from purchases group by currency order by currency)x)),
    'quality',jsonb_build_object('errorStartedAt',error_started,
      'versions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select platform,app_version version,count(distinct user_id) members,count(*) visits
        from visits where first_at>=since group by platform,app_version order by members desc)x),
      -- Legacy fingerprints merge accounts/platforms and lifetime totals; operational reference only.
      'errorGroups',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select platform,app_version version,count(*) groups,sum(occurrences) "lifetimeReports"
        from private.client_errors where p_include_internal and p_city is null and p_tier='all' and last_seen>=since
          and (p_platform='all' or platform=p_platform) group by platform,app_version order by groups desc)x),
      'failures',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select kind,count(distinct user_id) members from product
        where kind in ('client_error','photo_upload_error','map_error') group by kind order by kind)x),
      'openReports',(select count(*) from public.reports r join members m on m.id=r.reporter_id where r.source='report' and r.status='open'),
      'resolvedReports',(select count(*) from public.reports r join members m on m.id=r.reporter_id where r.source='report' and r.resolved_at>=since),
      'averageResolutionHours',(select round(avg(extract(epoch from (r.resolved_at-r.created_at))/3600)::numeric,1) from public.reports r
        join members m on m.id=r.reporter_id where r.source='report' and r.resolved_at>=since and r.resolved_at>=r.created_at))
  ) into result;
  return result;
end;
$$;
alter function public.get_admin_performance(integer,text,text,boolean,text) owner to postgres;
revoke all on function public.get_admin_performance(integer,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_performance(integer,text,text,boolean,text) to authenticated;

-- Preserve the existing owner, schedule and job ID; only extend its current retention work.
do $$
declare job record; definition text;
begin
  select jobid,command into job from cron.job where jobname='gling-behavior-retention';
  if job.jobid is null then raise exception 'BEHAVIOR_RETENTION_REQUIRED'; end if;
  perform cron.alter_job(job.jobid,command:=job.command||E';\ndelete from private.product_events where created_at<now()-interval ''90 days'';');
  definition:=pg_get_functiondef('private.purge_deleted_behavior()'::regprocedure);
  if strpos(definition,'delete from private.behavior_events where user_id=new.id;')=0 then raise exception 'ACTIVITY_DELETE_CHANGED'; end if;
  execute replace(definition,'delete from private.behavior_events where user_id=new.id;',
    'delete from private.behavior_events where user_id=new.id; delete from private.product_events where user_id=new.id;');
end;
$$;

notify pgrst,'reload schema';
