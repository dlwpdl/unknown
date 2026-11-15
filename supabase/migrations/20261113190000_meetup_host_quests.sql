-- 모임장 퀘스트(한 사람 평생 최대 $20). 운영팀이 만든 코드로 시작하고, 단계 판정·확정·송금 자격은 모두 서버가 정한다.
-- 코드 값은 관리자 화면에서만 만든다. 이 파일과 저장소에는 코드가 없다.
-- 판정 규칙: 모임장 모임과 4단계 초대 회원이 간 모임 모두 시작 24시간 전에 공지된 4시간 이하 공개 모임만,
-- 4단계는 다른 모임장 모임에서 QR로 온 사람만, 15초마다 바뀌는 1회용 QR, 같은 사람·같은 기기 제외,
-- 송금 전 사진 인원(그 모임에서 센 참석자 + 모임장 이상)·참석자 2명 확인·은행 이름 대조.
-- 같은 사람 판별(메일 별칭 포함)은 초대 보상과 같은 private.invite_marks를 쓴다.

-- 관리자 접근 기록에 퀘스트 범위를 더한다(다른 범위는 그대로 둔다).
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid='public.admin_access_logs'::regclass and conname='admin_access_logs_scope_check';
  if def is null or strpos(def,'''trust_level''::text')=0 then raise exception 'ADMIN_SCOPE_CHECK_CHANGED'; end if;
  if strpos(def,'''host_quests''')=0 then
    execute 'alter table public.admin_access_logs drop constraint admin_access_logs_scope_check';
    execute 'alter table public.admin_access_logs add constraint admin_access_logs_scope_check '
      ||replace(def,'''trust_level''::text','''trust_level''::text, ''host_quests''::text');
  end if;
end $$;

-- 체크인 방식: 버튼(지금 그대로)과 QR. 퀘스트는 QR 체크인만 센다.
alter table private.meetup_attendance
  add column check_in_method text check (check_in_method in ('button','qr')),
  add column check_in_device text check (check_in_device ~ '^[0-9a-f]{64}$');
create function private.mark_meetup_check_in_method() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.checked_in_at is not null and new.check_in_method is null then new.check_in_method:='button'; end if;
  return new;
end $$;
create trigger meetup_attendance_check_in_method before insert or update of checked_in_at on private.meetup_attendance
  for each row execute function private.mark_meetup_check_in_method();

create table private.meetup_qr_codes(
  code text primary key check (code ~ '^[0-9a-f]{24}$'),
  session_id uuid not null references private.meetup_sessions(id) on delete cascade,
  issued_at timestamptz not null default clock_timestamp(),
  used_by uuid references public.profiles(id) on delete cascade,
  used_at timestamptz,
  check ((used_by is null) = (used_at is null)));
create index meetup_qr_codes_session on private.meetup_qr_codes(session_id, issued_at desc);

create table private.host_quest_program(
  id boolean primary key default true check (id),
  -- 합치고 올려도 꺼진 채로 둔다. 켜는 건 사장님 지시가 있을 때 관리자 화면이나 SQL로만.
  accepting boolean not null default false,
  code_limit integer not null default 10 check (code_limit between 0 and 1000),
  -- 프로그램을 끝낸 날(사장님 SQL: update private.host_quest_program set ended_at=now()). 새 시작을 막고, 1년 뒤 참여 기록을 지운다.
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null);
insert into private.host_quest_program(id) values (true);

create table private.host_quest_codes(
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  recipient_name text check (char_length(recipient_name) between 1 and 80),
  note text check (char_length(note) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz);

create table private.host_quests(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  code text not null unique references private.host_quest_codes(code),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','paid','converted','ended')),
  finished_at timestamptz,
  converted_days integer check (converted_days between 0 and 28),
  end_note text check (char_length(end_note) <= 300),
  check (ends_at > started_at));

-- 퀘스트를 시작한 사람의 이메일·전화·기기 해시. 계정을 지워도 남아서 같은 사람이 다시 시작하지 못한다.
create table private.host_quest_people(
  mark text primary key,
  quest_id uuid not null,
  created_at timestamptz not null default now());

create table private.host_quest_photos(
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null,
  session_id uuid not null,
  path text not null unique,
  fingerprint text not null,
  uploaded_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (char_length(review_note) <= 300),
  delete_after timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now());
create index host_quest_photos_quest on private.host_quest_photos(quest_id);
create index host_quest_photos_fingerprint on private.host_quest_photos(fingerprint);

create table private.host_quest_steps(
  id bigint generated always as identity primary key,
  quest_id uuid not null references private.host_quests(id) on delete cascade,
  step smallint not null check (step between 1 and 7),
  amount_cents integer not null check (amount_cents between 0 and 600),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  session_ids uuid[] not null default '{}',
  person_ids uuid[] not null default '{}',
  person_id uuid,
  photo_id uuid,
  earned_at timestamptz not null default now(),
  confirm_after timestamptz not null default now() + interval '14 days',
  held_reason text check (held_reason in ('report')),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  cancel_reason text check (cancel_reason in ('evidence_changed','admin','quest_ended')),
  note text check (char_length(note) <= 300),
  check ((step = 4) = (person_id is not null)),
  check ((status = 'cancelled') = (cancel_reason is not null)));
create unique index host_quest_steps_open on private.host_quest_steps(quest_id, step) where status <> 'cancelled' and step <> 4;
create unique index host_quest_steps_open_invitee on private.host_quest_steps(quest_id, person_id) where status <> 'cancelled' and step = 4;

create table private.host_quest_payouts(
  quest_id uuid primary key references private.host_quests(id) on delete cascade,
  email text check (char_length(email) between 3 and 254),
  legal_name text check (char_length(legal_name) between 2 and 80),
  email_mark text unique,
  status text not null default 'requested' check (status in ('requested','sent','held')),
  requested_at timestamptz not null default now(),
  photo_people integer check (photo_people between 0 and 100),
  photo_people_at timestamptz,
  photo_people_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  sent_by uuid references auth.users(id) on delete set null,
  transfer_last4 text check (transfer_last4 ~ '^[A-Za-z0-9]{4}$'),
  amount_cents integer check (amount_cents between 0 and 2000),
  held_at timestamptz,
  held_by uuid references auth.users(id) on delete set null,
  held_note text check (char_length(held_note) <= 300),
  erase_after timestamptz,
  erased_at timestamptz,
  check (status <> 'sent' or (sent_at is not null and transfer_last4 is not null and amount_cents is not null)));

create table private.host_quest_payout_checks(
  quest_id uuid not null references private.host_quests(id) on delete cascade,
  person_id uuid not null,
  session_id uuid not null,
  conversation_id uuid,
  asked_at timestamptz not null default now(),
  asked_by uuid references auth.users(id) on delete set null,
  answer text check (answer in ('yes','no','none')),
  answered_at timestamptz,
  answered_by uuid references auth.users(id) on delete set null,
  primary key (quest_id, person_id));

alter table private.meetup_qr_codes enable row level security;
alter table private.host_quest_program enable row level security;
alter table private.host_quest_codes enable row level security;
alter table private.host_quests enable row level security;
alter table private.host_quest_people enable row level security;
alter table private.host_quest_photos enable row level security;
alter table private.host_quest_steps enable row level security;
alter table private.host_quest_payouts enable row level security;
alter table private.host_quest_payout_checks enable row level security;
revoke all on private.meetup_qr_codes, private.host_quest_program, private.host_quest_codes, private.host_quests,
  private.host_quest_people, private.host_quest_photos, private.host_quest_steps, private.host_quest_payouts,
  private.host_quest_payout_checks from public, anon, authenticated, service_role;
alter table private.meetup_qr_codes owner to postgres;
alter table private.host_quest_program owner to postgres;
alter table private.host_quest_codes owner to postgres;
alter table private.host_quests owner to postgres;
alter table private.host_quest_people owner to postgres;
alter table private.host_quest_photos owner to postgres;
alter table private.host_quest_steps owner to postgres;
alter table private.host_quest_payouts owner to postgres;
alter table private.host_quest_payout_checks owner to postgres;

-- 남은 퀘스트 금액은 초대 보상 자리(invite_rewards)에 한 줄로 바꿔 준다. 초대 보상 56일 한도와는 따로 센다.
alter table private.invite_rewards drop constraint invite_rewards_reason_check;
alter table private.invite_rewards add constraint invite_rewards_reason_check
  check (reason in ('attended','business_inviter','business_invitee','quest'));
alter table private.invite_rewards drop constraint invite_rewards_days_check;
alter table private.invite_rewards add constraint invite_rewards_days_check
  check (days between 1 and 14 or (reason = 'quest' and kind = 'general' and days between 1 and 28));
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.grant_invite_reward(uuid,uuid,text,uuid,text)'::regprocedure);
  anchor:='select coalesce(sum(days), 0), greatest(now(), coalesce(max(ends_at), now())) into used, start_at';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'INVITE_REWARD_GRANT_CHANGED'; end if;
  execute replace(definition,anchor,
    'select coalesce(sum(days) filter (where reason <> ''quest''), 0), greatest(now(), coalesce(max(ends_at), now())) into used, start_at');
  definition:=pg_get_functiondef('public.get_my_invite()'::regprocedure);
  anchor:='into rewards from private.invite_rewards where user_id = u and kind = ''general'';';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'INVITE_SUMMARY_CHANGED'; end if;
  execute replace(definition,anchor,'into rewards from private.invite_rewards where user_id = u and kind = ''general'' and reason <> ''quest'';');
end $$;

-- 같은 사람 판별은 초대 보상과 같은 private.invite_marks(이메일·전화·기기)를 그대로 쓴다. 메일 별칭도 invite_marks가 묶는다.
create function private.host_quest_name_key(p_name text) returns text
language sql immutable set search_path='' as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p_name,''))),'[^[:alnum:]]+','','g'),'');
$$;

-- 퀘스트에 들어가는 모임: 4시간 이하, 초대 전용이 아닌 공개 모임, 시작 24시간 전에 글·일정이 올라와 있었을 것.
create function private.host_quest_session_problem(p_session uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when s.id is null or p.id is null then 'missing'
    when s.ends_at-s.starts_at>interval '4 hours' then 'too_long'
    when coalesce(p.room_preview->>'access','public')='invite' then 'invite_only'
    when p.created_at>s.starts_at-interval '24 hours'
      or (coalesce(p.room_preview->>'eventKind','group')<>'once' and s.created_at>s.starts_at-interval '24 hours') then 'late_notice'
  end
  from (select p_session id) x left join private.meetup_sessions s on s.id=x.id left join public.posts p on p.id=s.post_id;
$$;
create function private.host_quest_session_ok(p_quest uuid, p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.host_quests q join private.meetup_sessions s on s.host_id=q.user_id
    where q.id=p_quest and s.id=p_session and s.starts_at>=q.started_at and s.starts_at<q.ends_at)
    and private.host_quest_session_problem(p_session) is null;
$$;

-- 한 모임에서 누가 1명으로 세지는지와, 안 세지면 그 이유(null이면 셈).
create function private.host_quest_session_people(p_quest uuid, p_session uuid)
returns table(person_id uuid, reason text)
language sql stable security definer set search_path='' as $$
  with q as (select hq.id, hq.user_id, private.invite_marks(hq.user_id) marks from private.host_quests hq where hq.id=p_quest),
  s as (select ms.* from private.meetup_sessions ms join q on q.user_id=ms.host_id where ms.id=p_session),
  a as (select ma.user_id, ma.check_in_method, ma.check_in_device, ma.confirmed_at, ma.confirmation_source,
      private.invite_marks(ma.user_id) marks
    from private.meetup_attendance ma join s on s.id=ma.session_id
    where ma.user_id<>s.host_id and (ma.checked_in_at is not null or ma.confirmed_at is not null))
  select a.user_id, case
    when not private.is_active_account(a.user_id) then 'inactive'
    when private.is_operated_character(a.user_id) then 'operated'
    when a.check_in_method is distinct from 'qr' then 'not_qr'
    when a.confirmed_at is null or (a.confirmation_source='peer' and not (
      exists(select 1 from private.meetup_attendance_confirmations c where c.session_id=s.id and c.witness_id=s.host_id and c.attendee_id=a.user_id)
      and exists(select 1 from private.meetup_attendance_confirmations c where c.session_id=s.id and c.witness_id=a.user_id and c.attendee_id=s.host_id)))
      then 'not_confirmed'
    when exists(select 1 from private.meetup_absences x where x.session_id=s.id and x.user_id=a.user_id) then 'no_show'
    when a.marks && q.marks then 'same_person'
    when exists(select 1 from a b where b.user_id<>a.user_id and (b.marks && a.marks or b.check_in_device=a.check_in_device)) then 'same_device'
    -- 한 사람이 30일 안에 도와줄 수 있는 퀘스트 모임장은 2명까지(먼저 센 쪽이 남는다).
    when (select count(distinct oq.user_id) from private.host_quest_steps st join private.host_quests oq on oq.id=st.quest_id
        join private.meetup_sessions os on os.id=st.session_ids[1]
        where oq.id<>q.id and st.status<>'cancelled' and st.step in (2,5,7) and a.user_id=any(st.person_ids)
          and os.starts_at between s.starts_at-interval '30 days' and s.starts_at+interval '30 days')>=2 then 'helper_limit'
  end
  from a, q, s;
$$;
create function private.host_quest_counted(p_quest uuid, p_session uuid) returns uuid[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(person_id order by person_id),'{}') from private.host_quest_session_people(p_quest,p_session) where reason is null;
$$;

-- 단체 사진 속 사람은 그 모임에서 퀘스트로 센 참석자와 모임장을 합친 수 이상이어야 한다.
create function private.host_quest_photo_needed(p_quest uuid) returns integer
language sql stable security definer set search_path='' as $$
  select 1+cardinality(private.host_quest_counted(p_quest,st.session_ids[1]))
  from private.host_quest_steps st where st.quest_id=p_quest and st.step=3 and st.status<>'cancelled' and st.session_ids[1] is not null
  order by st.id desc limit 1;
$$;

-- 4단계(사장님 확정 Q1): 내 코드로 퀘스트 시작 뒤 가입한 사람이 **다른 모임장**의 글링 모임에서 QR로 체크인하고 그 모임장과 서로 참석 확인을 받았는지.
-- 퀘스트 모임장 본인(같은 사람의 다른 계정 포함)이 연 모임은 세지 않는다.
create function private.host_quest_invitee(p_quest uuid, p_invitee uuid)
returns table(session_id uuid, reason text, confirmed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare q private.host_quests; mine text[]; host_marks text[]; found_session uuid; found_at timestamptz;
begin
  select * into q from private.host_quests where id=p_quest;
  mine:=private.invite_marks(p_invitee); host_marks:=private.invite_marks(q.user_id);
  if not private.is_active_account(p_invitee) then return query select null::uuid,'inactive'::text,null::timestamptz; return; end if;
  if private.is_operated_character(p_invitee) then return query select null::uuid,'operated'::text,null::timestamptz; return; end if;
  if p_invitee=q.user_id or mine && host_marks then return query select null::uuid,'same_person'::text,null::timestamptz; return; end if;
  if exists(select 1 from private.invite_redemptions r where r.inviter_id=q.user_id and r.invitee_id<>p_invitee
      and r.redeemed_at>=q.started_at and private.invite_marks(r.invitee_id) && mine)
    or exists(select 1 from private.invite_identity_marks m where m.mark=any(mine) and m.invitee_id<>p_invitee)
    then return query select null::uuid,'duplicate'::text,null::timestamptz; return; end if;
  select a.session_id, a.confirmed_at into found_session, found_at
    from private.meetup_attendance a join private.meetup_sessions ms on ms.id=a.session_id
    where a.user_id=p_invitee and a.confirmed_at is not null and ms.host_id<>p_invitee
      and ms.starts_at>=q.started_at and ms.ends_at<=now()
      and (a.confirmation_source<>'peer' or (
        exists(select 1 from private.meetup_attendance_confirmations c where c.session_id=ms.id and c.witness_id=ms.host_id and c.attendee_id=p_invitee)
        and exists(select 1 from private.meetup_attendance_confirmations c where c.session_id=ms.id and c.witness_id=p_invitee and c.attendee_id=ms.host_id)))
      and a.check_in_method='qr'
      and not exists(select 1 from private.meetup_absences x where x.session_id=ms.id and x.user_id=p_invitee)
      and ms.host_id<>q.user_id and not (private.invite_marks(ms.host_id) && host_marks)
      and private.host_quest_session_problem(ms.id) is null
      and not (private.invite_marks(ms.host_id) && mine)
    order by a.confirmed_at, ms.id limit 1;
  if found_session is null then return query select null::uuid,'waiting'::text,null::timestamptz; return; end if;
  return query select found_session,null::text,found_at;
end $$;

create function private.host_quest_totals(p_quest uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with s as (select * from private.host_quest_steps where quest_id=p_quest and status<>'cancelled'),
  inv as (select count(*) total, count(*) filter (where status='confirmed') done from s where step=4)
  select jsonb_build_object(
    'confirmed', coalesce((select sum(amount_cents) from s where step<>4 and status='confirmed'),0)
      + (select case when done>=3 then least(done,3)*100 else 0 end from inv),
    'pending', coalesce((select sum(amount_cents) from s where step<>4 and status='pending'),0)
      + (select case when total>=3 then least(total,3)*100 else 0 end - case when done>=3 then least(done,3)*100 else 0 end from inv),
    'invitees', (select total from inv));
$$;

-- 단계 한 줄을 맞춘다. p_sessions가 null이면 더 이상 깨지 않은 상태라 확인 중인 줄을 취소한다. 확정된 줄은 바꾸지 않는다.
create function private.host_quest_set_step(p_quest uuid, p_step int, p_amount int, p_sessions uuid[], p_people uuid[],
  p_person uuid default null, p_photo uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare cur private.host_quest_steps;
begin
  select * into cur from private.host_quest_steps where quest_id=p_quest and step=p_step and status<>'cancelled'
    and (p_step<>4 or person_id=p_person) for update;
  if cur.id is not null then
    if cur.status='confirmed' then return; end if;
    if p_sessions is not null and (p_step in (4,6) or (cur.session_ids[1] is not distinct from p_sessions[1] and cur.photo_id is not distinct from p_photo)) then
      update private.host_quest_steps set session_ids=p_sessions, person_ids=coalesce(p_people,'{}')
        where id=cur.id and (session_ids,person_ids) is distinct from (p_sessions,coalesce(p_people,'{}'));
      return;
    end if;
    update private.host_quest_steps set status='cancelled', cancel_reason='evidence_changed', decided_at=now() where id=cur.id;
  end if;
  if p_sessions is null then return; end if;
  -- 운영팀이 취소한 같은 근거로는 다시 쌓지 않는다.
  if exists(select 1 from private.host_quest_steps where quest_id=p_quest and step=p_step and cancel_reason='admin'
      and (p_step<>4 or person_id=p_person) and (p_step in (4,6) or (session_ids[1] is not distinct from p_sessions[1] and photo_id is not distinct from p_photo)))
    then return; end if;
  insert into private.host_quest_steps(quest_id,step,amount_cents,session_ids,person_ids,person_id,photo_id)
    values(p_quest,p_step,p_amount,p_sessions,coalesce(p_people,'{}'),p_person,p_photo);
end $$;

create function private.evaluate_host_quest(p_quest uuid) returns void
language plpgsql security definer set search_path='' as $$
declare q private.host_quests; first_id uuid; first_start timestamptz; first_people uuid[]; second_id uuid; third_id uuid;
  ids uuid[]; people uuid[]; photo private.host_quest_photos; inv record; picked integer; rv record;
begin
  -- 한 번에 하나씩 판정한다(품앗이 한도를 두 모임장이 동시에 넘지 않게).
  perform pg_advisory_xact_lock(hashtextextended('host-quest-evaluate:'||p_quest::text,0));
  select * into q from private.host_quests where id=p_quest for update;
  if q.id is null or q.status<>'active' then return; end if;

  -- 1·2단계: 첫 모임(나 말고 3명 이상).
  select session_ids[1], person_ids into first_id, first_people from private.host_quest_steps where quest_id=q.id and step=2 and status='confirmed';
  if first_id is null then
    select s.id into first_id from private.meetup_sessions s
      where s.host_id=q.user_id and s.ends_at<=now() and private.host_quest_session_ok(q.id,s.id)
        and cardinality(private.host_quest_counted(q.id,s.id))>=3
      order by s.starts_at, s.id limit 1;
    first_people:=case when first_id is not null then private.host_quest_counted(q.id,first_id) end;
  end if;
  select starts_at into first_start from private.meetup_sessions where id=first_id;
  ids:=case when first_id is not null then array[first_id] end;
  perform private.host_quest_set_step(q.id,2,300,ids,first_people);
  perform private.host_quest_set_step(q.id,1,100,ids,first_people);

  -- 5단계: 첫 모임 7일 뒤부터, 4명 이상, 그중 1명 이상은 첫 모임에도 온 사람.
  select session_ids[1] into second_id from private.host_quest_steps where quest_id=q.id and step=5 and status='confirmed';
  if second_id is null and first_id is not null then
    select s.id into second_id from private.meetup_sessions s
      where s.host_id=q.user_id and s.ends_at<=now() and s.id<>first_id and s.starts_at>=first_start+interval '7 days'
        and private.host_quest_session_ok(q.id,s.id)
        and cardinality(private.host_quest_counted(q.id,s.id))>=4 and private.host_quest_counted(q.id,s.id) && first_people
      order by s.starts_at, s.id limit 1;
  end if;
  people:=case when second_id is not null then private.host_quest_counted(q.id,second_id) end;
  perform private.host_quest_set_step(q.id,5,400,case when second_id is not null then array[second_id] end,people);

  -- 7단계: 첫 모임·두 번째 모임과 다른 모임, 퀘스트 시작 30일 안, 4명 이상.
  select session_ids[1] into third_id from private.host_quest_steps where quest_id=q.id and step=7 and status='confirmed';
  if third_id is null and second_id is not null then
    select s.id into third_id from private.meetup_sessions s
      where s.host_id=q.user_id and s.ends_at<=now() and s.id not in (first_id,second_id)
        and s.starts_at>first_start and s.starts_at<q.started_at+interval '30 days'
        and private.host_quest_session_ok(q.id,s.id) and cardinality(private.host_quest_counted(q.id,s.id))>=4
      order by s.starts_at, s.id limit 1;
  end if;
  people:=case when third_id is not null then private.host_quest_counted(q.id,third_id) end;
  perform private.host_quest_set_step(q.id,7,600,case when third_id is not null then array[third_id] end,people);

  -- 3단계: 운영팀이 승인한 단체 사진.
  select p.* into photo from private.host_quest_photos p
    where p.quest_id=q.id and p.status='approved' and private.host_quest_session_ok(q.id,p.session_id)
    order by p.reviewed_at, p.id limit 1;
  perform private.host_quest_set_step(q.id,3,200,case when photo.id is not null then array[photo.session_id] end,'{}',null,photo.id);

  -- 4단계: 초대한 사람 3명(먼저 참석 확인된 순서). 3명이 되면 $3이고 그 뒤로는 쌓이지 않는다.
  select count(*) into picked from private.host_quest_steps where quest_id=q.id and step=4 and status='confirmed';
  for inv in
    select r.invitee_id, i.session_id, i.reason,
      exists(select 1 from private.host_quest_steps st where st.quest_id=q.id and st.step=4 and st.status='confirmed' and st.person_id=r.invitee_id) done
    from private.invite_redemptions r join private.invite_links l on l.id=r.link_id and l.merchant_id is null
    join public.profiles p on p.id=r.invitee_id
    cross join lateral private.host_quest_invitee(q.id,r.invitee_id) i
    where r.inviter_id=q.user_id and r.redeemed_at>=q.started_at and p.created_at>=q.started_at
    order by i.confirmed_at nulls last, r.redeemed_at, r.invitee_id
  loop
    if inv.done then continue; end if;
    if inv.reason is null and picked<3 then
      perform private.host_quest_set_step(q.id,4,100,array[inv.session_id],array[inv.invitee_id],inv.invitee_id);
      picked:=picked+1;
    else
      perform private.host_quest_set_step(q.id,4,100,null,null,inv.invitee_id);
    end if;
  end loop;
  -- 초대 연결이 사라진 사람의 확인 중 줄도 정리한다.
  update private.host_quest_steps st set status='cancelled', cancel_reason='evidence_changed', decided_at=now()
    where st.quest_id=q.id and st.step=4 and st.status='pending' and not exists(select 1 from private.invite_redemptions r
      where r.invitee_id=st.person_id and r.inviter_id=q.user_id and r.redeemed_at>=q.started_at);

  -- 6단계: 세는 참석자가 남긴 모임 후기 2개(다른 두 사람).
  select array_agg(x.author_id order by x.created_at, x.author_id) authors, array_agg(x.session_id order by x.created_at, x.author_id) sessions into rv
    from (select distinct on (tr.author_id) tr.author_id, tr.session_id, tr.created_at
      from private.trust_reviews tr join private.meetup_sessions s on s.id=tr.session_id
      where tr.kind='meetup' and tr.status in ('pending','published') and s.host_id=q.user_id and s.ends_at<=now()
        and private.host_quest_session_ok(q.id,s.id) and tr.author_id=any(private.host_quest_counted(q.id,s.id))
      order by tr.author_id, tr.created_at) x;
  perform private.host_quest_set_step(q.id,6,100,
    case when cardinality(rv.authors)>=2 then rv.sessions[1:2] end,
    case when cardinality(rv.authors)>=2 then rv.authors[1:2] end);
end $$;

-- 남은 확정 금액을 멤버십 이용권으로 바꾸고 퀘스트를 끝낸다. $10마다 14일, 첫 모임을 연 적이 있으면 프로.
create function private.convert_host_quest(p_quest uuid, p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare q private.host_quests; cents integer; v_days integer; v_tier text; start_at timestamptz;
begin
  select * into q from private.host_quests where id=p_quest for update;
  if q.id is null or q.status<>'active' then return 0; end if;
  update private.host_quest_steps set status='cancelled', cancel_reason='quest_ended', decided_at=now() where quest_id=q.id and status='pending';
  cents:=(private.host_quest_totals(q.id)->>'confirmed')::int;
  v_days:=least(28,floor(cents*14/1000.0)::int);
  v_tier:=case when exists(select 1 from private.host_quest_steps where quest_id=q.id and step=2 and status='confirmed') then 'pro' else 'plus' end;
  if v_days>0 and private.is_active_account(q.user_id) then
    perform pg_advisory_xact_lock(hashtextextended('invite-reward:'||q.user_id::text,0));
    select greatest(now(),coalesce(max(ends_at),now())) into start_at from private.invite_rewards where kind='general' and user_id=q.user_id;
    insert into private.invite_rewards(user_id,merchant_id,kind,tier,days,starts_at,ends_at,invitee_id,reason)
      values(q.user_id,null,'general',v_tier,v_days,start_at,start_at+make_interval(days=>v_days),q.user_id,'quest')
      on conflict (invitee_id,reason) do nothing;
  else v_days:=0; end if;
  update private.host_quests set status='converted', converted_days=v_days, finished_at=now(), end_note=left(p_note,300) where id=q.id;
  return v_days;
end $$;

-- 14일이 지난 확인 중 금액을 확정한다. 모임장이나 퀘스트 모임 글에 처리 안 된 신고가 있으면 운영팀 판단으로 넘기고, 신고가 정리되면 다시 확정한다.
create function private.settle_host_quest(p_quest uuid) returns void
language plpgsql security definer set search_path='' as $$
declare q private.host_quests; reported boolean;
begin
  perform private.evaluate_host_quest(p_quest);
  select * into q from private.host_quests where id=p_quest;
  if q.id is null or q.status<>'active' then return; end if;
  reported:=exists(select 1 from public.reports r where r.status<>'dismissed' and r.created_at>=q.started_at
    and (r.reported_user_id=q.user_id or (r.target_type='post' and r.target_id in (
      select s.post_id from private.meetup_sessions s where s.host_id=q.user_id and s.starts_at>=q.started_at))));
  update private.host_quest_steps set
      status=case when reported then 'pending' else 'confirmed' end,
      held_reason=case when reported then 'report' end,
      decided_at=case when reported then decided_at else now() end
    where quest_id=q.id and status='pending' and confirm_after<=now();
  if now()>=q.ends_at+interval '8 days'
    and not exists(select 1 from private.host_quest_steps where quest_id=q.id and status='pending')
    and not exists(select 1 from private.host_quest_payouts where quest_id=q.id) then
    perform private.convert_host_quest(q.id,'60일이 지나 멤버십 이용권으로 바꿈');
  end if;
end $$;

create function private.run_host_quests() returns void
language plpgsql security definer set search_path='' as $$
declare r record;
begin
  for r in select id from private.host_quests where status='active' order by started_at loop
    perform private.settle_host_quest(r.id);
  end loop;
  update private.host_quest_payouts set email=null, legal_name=null, erased_at=now() where erase_after<=now() and erased_at is null;
  delete from private.meetup_qr_codes where issued_at<now()-interval '1 day';
end $$;

-- 계정을 지우면: 진행 중 퀘스트는 끝내고, 송금 정보는 바로 지우고, 사진은 다음 정리 때 지운다.
create function private.purge_host_quest_account_data(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update private.host_quest_steps st set status='cancelled', cancel_reason='quest_ended', decided_at=now()
    from private.host_quests q where q.id=st.quest_id and q.user_id=p_user and st.status='pending';
  update private.host_quests set status='ended', finished_at=now(), end_note='계정 삭제' where user_id=p_user and status='active';
  update private.host_quest_payouts p set email=null, legal_name=null, erased_at=now(),
      status=case when p.status='requested' then 'held' else p.status end,
      held_at=case when p.status='requested' then now() else p.held_at end
    from private.host_quests q where q.id=p.quest_id and q.user_id=p_user;
  update private.host_quest_photos ph set delete_after=now() from private.host_quests q
    where q.id=ph.quest_id and q.user_id=p_user and ph.deleted_at is null;
  delete from private.meetup_qr_codes where used_by=p_user;
end $$;
do $$
declare definition text; anchor text:='perform private.purge_meetup_convenience_account_data(current_user_id);';
begin
  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'HOST_QUEST_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' perform private.purge_host_quest_account_data(current_user_id);');
end $$;

-- QR 체크인 ---------------------------------------------------------------
-- 모임장 화면용 QR. 15초마다 새 코드를 주고, 누가 한 번 찍으면 그 코드는 끝난다.
create function public.get_meetup_check_in_qr(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s private.meetup_sessions; code_row private.meetup_qr_codes; quest uuid; t timestamptz:=clock_timestamp();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into s from private.meetup_sessions where id=p_session_id;
  if s.id is null or s.host_id<>u then raise exception 'SESSION_NOT_FOUND'; end if;
  if t<s.starts_at or t>=s.ends_at then raise exception 'CHECK_IN_CLOSED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('meetup-qr:'||s.id::text,0));
  select * into code_row from private.meetup_qr_codes where session_id=s.id and used_at is null and issued_at>t-interval '15 seconds'
    order by issued_at desc limit 1;
  if code_row.code is null then
    insert into private.meetup_qr_codes(code,session_id,issued_at) values(encode(extensions.gen_random_bytes(12),'hex'),s.id,t) returning * into code_row;
  end if;
  select id into quest from private.host_quests where user_id=u and status='active';
  return jsonb_build_object(
    'url','https://gling.ej-entertainment.com/checkin?s='||s.id::text||'&c='||code_row.code,
    'expiresAt',code_row.issued_at+interval '15 seconds',
    'checkedIn',(select count(*) from private.meetup_attendance a where a.session_id=s.id and a.user_id<>u and a.checked_in_at is not null),
    'questProblem',case when quest is null then null when s.starts_at<(select started_at from private.host_quests where id=quest) then 'before_quest'
      else private.host_quest_session_problem(s.id) end,
    'questActive',quest is not null);
end $$;

create function public.check_in_meetup_qr(p_session_id uuid, p_code text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s private.meetup_sessions; device text; consumed text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into s from private.meetup_sessions where id=p_session_id;
  if s.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.host_id=u then raise exception 'INVALID_ATTENDEE'; end if;
  select a.device_hash into device from private.account_security_sessions a
    where a.session_id=nullif(auth.jwt()->>'session_id','')::uuid and a.user_id=u;
  if device is null then raise exception 'DEVICE_REQUIRED'; end if;
  perform private.enforce_rate_limit('meetup_qr_check_in',30,interval '1 hour');
  perform pg_advisory_xact_lock(hashtextextended('meetup-qr:'||s.id::text,0));
  update private.meetup_qr_codes set used_by=u, used_at=clock_timestamp()
    where code=lower(btrim(coalesce(p_code,''))) and session_id=s.id and used_at is null and issued_at>clock_timestamp()-interval '30 seconds'
    returning code into consumed;
  if consumed is null then raise exception 'QR_EXPIRED'; end if;
  -- 기존 체크인 규칙(승인된 참석자, 모임 시간 안)을 그대로 쓴다. 실패하면 코드 사용도 되돌아간다.
  perform public.check_in_meetup(s.id);
  update private.meetup_attendance set check_in_method='qr', check_in_device=device where session_id=s.id and user_id=u;
  return s.post_id;
end $$;

-- 퀘스트(회원) ------------------------------------------------------------
create function public.start_host_quest(p_code text, p_agreed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c private.host_quest_codes; marks text[]; new_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.enforce_rate_limit('host_quest_start',10,interval '1 day');
  if not coalesce(p_agreed,false) then raise exception 'QUEST_AGREEMENT_REQUIRED'; end if;
  if not coalesce((select accepting and ended_at is null from private.host_quest_program where id),false) then raise exception 'QUEST_PAUSED'; end if;
  if private.is_operated_character(u) then raise exception 'QUEST_NOT_AVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('host-quest-start',0));
  marks:=private.invite_marks(u);
  if exists(select 1 from private.host_quests where user_id=u) or exists(select 1 from private.host_quest_people where mark=any(marks))
    then raise exception 'QUEST_ALREADY_USED'; end if;
  select * into c from private.host_quest_codes where code=upper(btrim(coalesce(p_code,''))) and used_at is null for update;
  if c.code is null then raise exception 'QUEST_CODE_NOT_FOUND'; end if;
  insert into private.host_quests(user_id,code,started_at,ends_at) values(u,c.code,now(),now()+interval '60 days') returning id into new_id;
  update private.host_quest_codes set used_at=now() where code=c.code;
  insert into private.host_quest_people(mark,quest_id) select m,new_id from unnest(marks) m on conflict do nothing;
  return jsonb_build_object('started',true);
end $$;

create function public.get_my_host_quest() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); q private.host_quests; totals jsonb; pay private.host_quest_payouts;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.enforce_rate_limit('host_quest_read',120,interval '1 hour');
  select * into q from private.host_quests where user_id=u;
  if q.id is null then
    return jsonb_build_object('status','none','accepting',coalesce((select accepting and ended_at is null from private.host_quest_program where id),false));
  end if;
  if q.status='active' then perform private.evaluate_host_quest(q.id); end if;
  totals:=private.host_quest_totals(q.id);
  select * into pay from private.host_quest_payouts where quest_id=q.id;
  return jsonb_build_object(
    'status',q.status,'startedAt',q.started_at,'endsAt',q.ends_at,'convertedDays',q.converted_days,
    'confirmed',(totals->>'confirmed')::int,'pending',(totals->>'pending')::int,
    'steps',(select jsonb_agg(jsonb_build_object('step',n,
        'status',coalesce((select case when bool_and(st.status='confirmed') then 'confirmed' when bool_or(st.held_reason is not null) then 'held' else 'pending' end
          from private.host_quest_steps st where st.quest_id=q.id and st.step=n and st.status<>'cancelled'),'todo'),
        'confirmAfter',(select max(st.confirm_after) from private.host_quest_steps st where st.quest_id=q.id and st.step=n and st.status='pending'))
      order by n) from generate_series(1,7) n),
    'invitees',(select coalesce(jsonb_agg(jsonb_build_object('nickname',p.nickname,
        'state',case when st.status='confirmed' then 'confirmed' when st.status='pending' then 'pending'
          when i.reason in ('operated','same_person','duplicate') then 'not_counted' else coalesce(i.reason,'over_limit') end)
        order by st.status nulls last, r.redeemed_at),'[]')
      from private.invite_redemptions r join private.invite_links l on l.id=r.link_id and l.merchant_id is null
      join public.profiles p on p.id=r.invitee_id
      cross join lateral private.host_quest_invitee(q.id,r.invitee_id) i
      left join private.host_quest_steps st on st.quest_id=q.id and st.step=4 and st.person_id=r.invitee_id and st.status<>'cancelled'
      where r.inviter_id=q.user_id and r.redeemed_at>=q.started_at and p.created_at>=q.started_at),
    'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',p.title,'startsAt',s.starts_at,'endsAt',s.ends_at,
        'problem',case when s.starts_at<q.started_at or s.starts_at>=q.ends_at then 'outside_quest' else private.host_quest_session_problem(s.id) end,
        -- 같은 사람·운영 계정·다른 퀘스트 판별은 하나로 합친다. 자세한 이유는 관리자 화면에서만 본다.
        'people',(select coalesce(jsonb_agg(jsonb_build_object('nickname',pp.nickname,'reason',r.reason) order by r.reason nulls first, pp.nickname),'[]')
          from private.host_quest_session_people(q.id,s.id) sp join public.profiles pp on pp.id=sp.person_id
          cross join lateral (select case when sp.reason in ('operated','same_person','same_device','helper_limit') then 'not_counted' else sp.reason end) r(reason)))
        order by s.starts_at),'[]')
      from private.meetup_sessions s join public.posts p on p.id=s.post_id
      where s.host_id=u and s.ends_at>q.started_at and s.starts_at<q.ends_at),
    'photo',(select jsonb_build_object('status',ph.status,'sessionId',ph.session_id,'uploadedAt',ph.uploaded_at)
      from private.host_quest_photos ph where ph.quest_id=q.id order by ph.created_at desc limit 1),
    'payout',case when pay.quest_id is null then null else jsonb_build_object('status',pay.status,'requestedAt',pay.requested_at,
      'email',pay.email,'legalName',pay.legal_name,'sentAt',pay.sent_at,'transferLast4',pay.transfer_last4) end,
    'canRequestPayout',q.status='active' and (totals->>'confirmed')::int>=2000 and (pay.quest_id is null or pay.status='requested'));
end $$;

create function public.request_host_quest_payout(p_email text, p_legal_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); q private.host_quests; v_quest uuid; email text:=lower(btrim(coalesce(p_email,'')));
  name text:=regexp_replace(btrim(coalesce(p_legal_name,'')),'\s+',' ','g'); mark text; existing private.host_quest_payouts;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.enforce_rate_limit('host_quest_payout',10,interval '1 day');
  if char_length(email)>254 or email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;
  if char_length(name) not between 2 and 80 then raise exception 'INVALID_NAME'; end if;
  select id into v_quest from private.host_quests where user_id=u;
  if v_quest is null then raise exception 'QUEST_NOT_FOUND'; end if;
  perform private.evaluate_host_quest(v_quest);
  select * into q from private.host_quests where id=v_quest for update;
  if q.status<>'active' then raise exception 'QUEST_ENDED'; end if;
  if (private.host_quest_totals(q.id)->>'confirmed')::int<2000 then raise exception 'PAYOUT_NOT_READY'; end if;
  mark:=encode(extensions.digest('payout-email:'||email,'sha256'),'hex');
  if exists(select 1 from private.host_quest_payouts where email_mark=mark and quest_id<>q.id) then raise exception 'PAYOUT_EMAIL_USED'; end if;
  select * into existing from private.host_quest_payouts where quest_id=q.id for update;
  if existing.quest_id is not null and existing.status<>'requested' then raise exception 'PAYOUT_LOCKED'; end if;
  insert into private.host_quest_payouts(quest_id,email,legal_name,email_mark) values(q.id,email,name,mark)
    on conflict (quest_id) do update set email=excluded.email, legal_name=excluded.legal_name, email_mark=excluded.email_mark, requested_at=now();
  return jsonb_build_object('requested',true);
end $$;

-- 인증샷: 앱이 비공개 버킷에 올린 뒤 이 함수로 낸다. 올린 시각이 모임 시간(+30분) 안이어야 한다.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('meetup-quest-photos','meetup-quest-photos',false,2097152,array['image/webp'])
on conflict (id) do nothing;
create function private.can_upload_host_quest_photo(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.is_active_account(auth.uid())
    and p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and split_part(p_path,'/',1)=auth.uid()::text
    and exists(select 1 from private.host_quests q join private.meetup_sessions s on s.host_id=q.user_id
      where q.user_id=auth.uid() and q.status='active' and s.id::text=split_part(p_path,'/',2)
        and now() between s.starts_at and s.ends_at+interval '30 minutes');
$$;
create function private.can_read_host_quest_photo(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); ph private.host_quest_photos; host uuid;
begin
  if uid is null or not private.is_active_account(uid) then return false; end if;
  if split_part(p_path,'/',1)=uid::text then return true; end if;
  if not private.is_admin() then return false; end if;
  select * into ph from private.host_quest_photos where path=p_path;
  if ph.id is null then return false; end if;
  select user_id into host from private.host_quests where id=ph.quest_id;
  perform public.log_admin_access('host_quests',host,ph.id);
  return true;
end $$;
create policy "quest hosts upload meetup photos" on storage.objects for insert to authenticated
  with check(bucket_id='meetup-quest-photos' and private.can_upload_host_quest_photo(name));
create policy "quest hosts and audited admins read meetup photos" on storage.objects for select to authenticated
  using(case when bucket_id='meetup-quest-photos' then private.can_read_host_quest_photo(name) else false end);

create function public.submit_host_quest_photo(p_session_id uuid, p_path text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); q private.host_quests; s private.meetup_sessions; o record; new_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into q from private.host_quests where user_id=u and status='active' for update;
  if q.id is null then raise exception 'QUEST_NOT_FOUND'; end if;
  select * into s from private.meetup_sessions where id=p_session_id and host_id=u;
  if s.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not private.host_quest_session_ok(q.id,s.id) then raise exception 'QUEST_SESSION_NOT_ELIGIBLE'; end if;
  if now()<s.starts_at or now()>s.ends_at+interval '30 minutes' then raise exception 'PHOTO_WINDOW_CLOSED'; end if;
  if coalesce(split_part(p_path,'/',1),'')<>u::text or split_part(p_path,'/',2)<>s.id::text then raise exception 'INVALID_QUEST_PHOTO'; end if;
  perform private.enforce_rate_limit('host_quest_photo',10,interval '1 day');
  select o2.created_at, nullif(btrim(o2.metadata->>'eTag','"'),'') etag into o from storage.objects o2
    where o2.bucket_id='meetup-quest-photos' and o2.name=p_path and (o2.owner_id=u::text or o2.owner=u)
      and o2.metadata->>'mimetype'='image/webp'
      and case when o2.metadata->>'size' ~ '^[0-9]{1,10}$' then (o2.metadata->>'size')::bigint between 1 and 2097152 else false end;
  if o.created_at is null or o.etag is null then raise exception 'INVALID_QUEST_PHOTO'; end if;
  if o.created_at<s.starts_at or o.created_at>s.ends_at+interval '30 minutes' then raise exception 'PHOTO_WINDOW_CLOSED'; end if;
  -- shortcut: 저장소 eTag(파일 내용 해시)라 똑같은 파일만 잡는다. 다시 찍거나 고친 사진까지 잡으려면 비슷한 사진 비교로 바꾼다.
  if exists(select 1 from private.host_quest_photos where fingerprint=o.etag) then raise exception 'PHOTO_DUPLICATE'; end if;
  if exists(select 1 from private.host_quest_photos where quest_id=q.id and status in ('pending','approved')) then raise exception 'PHOTO_ALREADY_SENT'; end if;
  insert into private.host_quest_photos(quest_id,session_id,path,fingerprint,uploaded_at,delete_after)
    values(q.id,s.id,p_path,o.etag,o.created_at,now()+interval '90 days') returning id into new_id;
  return new_id;
end $$;

-- 사진 정리(서비스 역할 전용, quest-photo-cleanup 함수가 부른다).
create function public.claim_host_quest_photo_cleanup(p_limit integer default 100) returns table(id uuid, path text)
language sql stable security definer set search_path='' as $$
  (select ph.id, ph.path from private.host_quest_photos ph where ph.deleted_at is null and ph.delete_after<=now()
    order by ph.delete_after limit least(greatest(coalesce(p_limit,100),1),100))
  union all
  -- 올렸지만 끝내 내지 않은 파일
  (select null::uuid, o.name from storage.objects o where o.bucket_id='meetup-quest-photos' and o.created_at<now()-interval '1 day'
    and not exists(select 1 from private.host_quest_photos ph where ph.path=o.name)
    order by o.created_at limit least(greatest(coalesce(p_limit,100),1),100));
$$;
create function public.finish_host_quest_photo_cleanup(p_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  update private.host_quest_photos set deleted_at=now() where id=any(coalesce(p_ids,'{}')) and deleted_at is null and delete_after<=now();
  get diagnostics n=row_count;
  return n;
end $$;

-- 운영팀(관리자) -----------------------------------------------------------
create function private.assert_host_quest_admin() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
end $$;

create function public.get_admin_host_quests() returns jsonb
language plpgsql security definer set search_path='' as $$
declare program private.host_quest_program;
begin
  perform private.assert_host_quest_admin();
  perform public.log_admin_access('host_quests',null,null);
  select * into program from private.host_quest_program where id;
  return jsonb_build_object(
    'accepting',program.accepting,'codeLimit',program.code_limit,
    'codesMade',(select count(*) from private.host_quest_codes),
    'remaining',greatest(program.code_limit-(select count(*) from private.host_quest_codes),0),
    'codes',(select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'recipientName',c.recipient_name,'note',c.note,
        'createdAt',c.created_at,'usedAt',c.used_at,'questId',q.id,'nickname',p.nickname) order by c.created_at desc),'[]')
      from private.host_quest_codes c left join private.host_quests q on q.code=c.code left join public.profiles p on p.id=q.user_id),
    'quests',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'hostId',q.user_id,'nickname',p.nickname,'status',q.status,
        'startedAt',q.started_at,'endsAt',q.ends_at,'totals',private.host_quest_totals(q.id),
        'payoutStatus',(select status from private.host_quest_payouts where quest_id=q.id),
        'photoPending',exists(select 1 from private.host_quest_photos ph where ph.quest_id=q.id and ph.status='pending'),
        'held',(select count(*) from private.host_quest_steps st where st.quest_id=q.id and st.status='pending' and st.held_reason is not null))
        order by (select requested_at from private.host_quest_payouts where quest_id=q.id) desc nulls last, q.started_at desc),'[]')
      from private.host_quests q join public.profiles p on p.id=q.user_id));
end $$;

create function public.get_admin_host_quest(p_quest_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.host_quests; c private.host_quest_codes; pay private.host_quest_payouts;
begin
  perform private.assert_host_quest_admin();
  select * into q from private.host_quests where id=p_quest_id;
  if q.id is null then raise exception 'QUEST_NOT_FOUND'; end if;
  perform public.log_admin_access('host_quests',q.user_id,q.id);
  select * into c from private.host_quest_codes where code=q.code;
  select * into pay from private.host_quest_payouts where quest_id=q.id;
  return jsonb_build_object(
    'id',q.id,'status',q.status,'startedAt',q.started_at,'endsAt',q.ends_at,'finishedAt',q.finished_at,'endNote',q.end_note,
    'convertedDays',q.converted_days,'totals',private.host_quest_totals(q.id),
    'host',(select jsonb_build_object('id',p.id,'nickname',p.nickname,'joinedAt',p.created_at) from public.profiles p where p.id=q.user_id),
    'code',jsonb_build_object('code',c.code,'recipientName',c.recipient_name,'note',c.note),
    'steps',(select coalesce(jsonb_agg(jsonb_build_object('id',st.id,'step',st.step,'amount',st.amount_cents,'status',st.status,
        'heldReason',st.held_reason,'cancelReason',st.cancel_reason,'earnedAt',st.earned_at,'confirmAfter',st.confirm_after,
        'sessionIds',st.session_ids,'personIds',st.person_ids,'personId',st.person_id,'photoId',st.photo_id,'note',st.note)
        order by st.step, st.id),'[]') from private.host_quest_steps st where st.quest_id=q.id),
    'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',p.title,'startsAt',s.starts_at,'endsAt',s.ends_at,
        'problem',private.host_quest_session_problem(s.id),
        'people',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.person_id,'nickname',pp.nickname,'reason',sp.reason,
            'qr',a.check_in_method='qr','confirmed',a.confirmed_at is not null,'joinedAt',pp.created_at,
            'otherHostMeetups',(select count(distinct oa.session_id) from private.meetup_attendance oa join private.meetup_sessions os on os.id=oa.session_id
              where oa.user_id=sp.person_id and oa.confirmed_at is not null and os.host_id<>q.user_id),
            'otherQuestHosts',(select count(distinct oq.user_id) from private.host_quest_steps st join private.host_quests oq on oq.id=st.quest_id
              where oq.id<>q.id and st.status<>'cancelled' and st.step in (2,5,7) and sp.person_id=any(st.person_ids)))
            order by sp.reason nulls first, pp.nickname),'[]')
          from private.host_quest_session_people(q.id,s.id) sp join public.profiles pp on pp.id=sp.person_id
          join private.meetup_attendance a on a.session_id=s.id and a.user_id=sp.person_id),
        'reports',(select count(*) from public.reports r where r.status<>'dismissed' and r.target_type='post' and r.target_id=s.post_id),
        'noShows',(select count(*) from private.meetup_absences x where x.session_id=s.id))
        order by s.starts_at),'[]')
      from private.meetup_sessions s join public.posts p on p.id=s.post_id
      where s.host_id=q.user_id and s.ends_at>q.started_at and s.starts_at<q.ends_at),
    'invitees',(select coalesce(jsonb_agg(jsonb_build_object('id',r.invitee_id,'nickname',p.nickname,'joinedAt',p.created_at,
        'sessionId',i.session_id,'reason',i.reason) order by r.redeemed_at),'[]')
      from private.invite_redemptions r join private.invite_links l on l.id=r.link_id and l.merchant_id is null
      join public.profiles p on p.id=r.invitee_id cross join lateral private.host_quest_invitee(q.id,r.invitee_id) i
      where r.inviter_id=q.user_id and r.redeemed_at>=q.started_at),
    'photos',(select coalesce(jsonb_agg(jsonb_build_object('id',ph.id,'path',case when ph.deleted_at is null then ph.path end,'status',ph.status,
        'sessionId',ph.session_id,'uploadedAt',ph.uploaded_at,'reviewedAt',ph.reviewed_at,'deleteAfter',ph.delete_after,'deletedAt',ph.deleted_at,
        'sameFileElsewhere',(select count(*) from private.host_quest_photos o where o.fingerprint=ph.fingerprint and o.id<>ph.id))
        order by ph.created_at desc),'[]') from private.host_quest_photos ph where ph.quest_id=q.id),
    'reports',(select count(*) from public.reports r where r.status<>'dismissed' and r.reported_user_id=q.user_id and r.created_at>=q.started_at),
    'payout',case when pay.quest_id is null then null else jsonb_build_object('status',pay.status,'email',pay.email,'legalName',pay.legal_name,
      'requestedAt',pay.requested_at,'photoPeople',pay.photo_people,'photoNeeded',private.host_quest_photo_needed(q.id),'sentAt',pay.sent_at,'transferLast4',pay.transfer_last4,
      'heldAt',pay.held_at,'heldNote',pay.held_note,'erasedAt',pay.erased_at,
      'nameMatches',private.host_quest_name_key(pay.legal_name) is not null and private.host_quest_name_key(pay.legal_name)=private.host_quest_name_key(c.recipient_name),
      'sameNameElsewhere',(select count(*) from private.host_quest_payouts o where o.quest_id<>q.id
        and private.host_quest_name_key(o.legal_name)=private.host_quest_name_key(pay.legal_name))) end,
    'checks',(select coalesce(jsonb_agg(jsonb_build_object('personId',k.person_id,'nickname',p.nickname,'sessionId',k.session_id,
        'conversationId',k.conversation_id,'askedAt',k.asked_at,'answer',k.answer,'answeredAt',k.answered_at) order by k.asked_at),'[]')
      from private.host_quest_payout_checks k left join public.profiles p on p.id=k.person_id where k.quest_id=q.id));
end $$;

create function public.create_admin_host_quest_codes(p_count integer, p_recipient_name text default null) returns text[]
language plpgsql security definer set search_path='' as $$
declare program private.host_quest_program; made integer; codes text[]:='{}'; next_code text; name text:=nullif(btrim(coalesce(p_recipient_name,'')),'');
begin
  perform private.assert_host_quest_admin();
  if p_count is null or p_count not between 1 and 50 then raise exception 'INVALID_CODE_COUNT'; end if;
  if char_length(name)>80 then raise exception 'INVALID_NAME'; end if;
  select * into program from private.host_quest_program where id for update;
  select count(*) into made from private.host_quest_codes;
  if made+p_count>program.code_limit then raise exception 'QUEST_CODE_LIMIT'; end if;
  while cardinality(codes)<p_count loop
    next_code:=private.invite_code();
    insert into private.host_quest_codes(code,recipient_name,created_by) values(next_code,name,auth.uid()) on conflict do nothing;
    if found then codes:=codes||next_code; end if;
  end loop;
  perform public.log_admin_access('host_quests',null,null);
  return codes;
end $$;

create function public.set_admin_host_quest_code(p_code text, p_recipient_name text, p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_name text:=nullif(regexp_replace(btrim(coalesce(p_recipient_name,'')),'\s+',' ','g'),''); v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  perform private.assert_host_quest_admin();
  if char_length(v_name)>80 or char_length(v_note)>200 then raise exception 'INVALID_NAME'; end if;
  if exists(select 1 from private.host_quests q join private.host_quest_payouts p on p.quest_id=q.id where q.code=upper(btrim(p_code)) and p.status='sent')
    then raise exception 'PAYOUT_LOCKED'; end if;
  update private.host_quest_codes set recipient_name=v_name, note=v_note where code=upper(btrim(coalesce(p_code,'')));
  if not found then raise exception 'QUEST_CODE_NOT_FOUND'; end if;
  perform public.log_admin_access('host_quests',(select user_id from private.host_quests where code=upper(btrim(p_code))),null);
end $$;

create function public.set_admin_host_quest_accepting(p_accepting boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_host_quest_admin();
  update private.host_quest_program set accepting=coalesce(p_accepting,false), updated_at=now(), updated_by=auth.uid() where id;
  perform public.log_admin_access('host_quests',null,null);
end $$;

create function public.review_admin_host_quest_photo(p_photo_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare ph private.host_quest_photos; host uuid;
begin
  perform private.assert_host_quest_admin();
  select * into ph from private.host_quest_photos where id=p_photo_id for update;
  if ph.id is null or ph.deleted_at is not null then raise exception 'PHOTO_NOT_FOUND'; end if;
  if ph.status<>'pending' then raise exception 'PHOTO_ALREADY_REVIEWED'; end if;
  update private.host_quest_photos set status=case when p_approve then 'approved' else 'rejected' end, reviewed_at=now(), reviewed_by=auth.uid(),
    review_note=left(nullif(btrim(coalesce(p_note,'')),''),300), delete_after=now()+interval '30 days' where id=ph.id;
  select user_id into host from private.host_quests where id=ph.quest_id;
  perform public.log_admin_access('host_quests',host,ph.id);
  if p_approve then perform private.evaluate_host_quest(ph.quest_id); end if;
end $$;

create function public.decide_admin_host_quest_step(p_step_id bigint, p_confirm boolean, p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare st private.host_quest_steps; host uuid;
begin
  perform private.assert_host_quest_admin();
  select * into st from private.host_quest_steps where id=p_step_id for update;
  if st.id is null or st.status<>'pending' then raise exception 'STEP_NOT_PENDING'; end if;
  if p_confirm and st.confirm_after>now() then raise exception 'STEP_NOT_DUE'; end if;
  update private.host_quest_steps set status=case when p_confirm then 'confirmed' else 'cancelled' end,
    cancel_reason=case when p_confirm then null else 'admin' end, held_reason=null,
    decided_at=now(), decided_by=auth.uid(), note=left(nullif(btrim(coalesce(p_note,'')),''),300) where id=st.id;
  select user_id into host from private.host_quests where id=st.quest_id;
  perform public.log_admin_access('host_quests',host,st.quest_id);
end $$;

create function public.end_admin_host_quest(p_quest_id uuid, p_convert boolean, p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare q private.host_quests; v_days integer:=0; note text:=left(nullif(btrim(coalesce(p_note,'')),''),300);
begin
  perform private.assert_host_quest_admin();
  if note is null then raise exception 'NOTE_REQUIRED'; end if;
  select * into q from private.host_quests where id=p_quest_id for update;
  if q.id is null or q.status<>'active' then raise exception 'QUEST_ENDED'; end if;
  if exists(select 1 from private.host_quest_payouts where quest_id=q.id and status='sent') then raise exception 'PAYOUT_LOCKED'; end if;
  if p_convert then v_days:=private.convert_host_quest(q.id,note);
  else
    update private.host_quest_steps set status='cancelled', cancel_reason='admin', decided_at=now(), decided_by=auth.uid()
      where quest_id=q.id and status='pending';
    update private.host_quests set status='ended', finished_at=now(), end_note=note where id=q.id;
  end if;
  update private.host_quest_payouts set status='held', held_at=now(), held_by=auth.uid(), held_note=note, erase_after=now()+interval '365 days'
    where quest_id=q.id and status='requested';
  perform public.log_admin_access('host_quests',q.user_id,q.id);
  return v_days;
end $$;

create function public.set_admin_host_quest_photo_people(p_quest_id uuid, p_count integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_host_quest_admin();
  if p_count is null or p_count not between 0 and 100 then raise exception 'INVALID_COUNT'; end if;
  update private.host_quest_payouts set photo_people=p_count, photo_people_at=now(), photo_people_by=auth.uid()
    where quest_id=p_quest_id and status<>'sent';
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  perform public.log_admin_access('host_quests',(select user_id from private.host_quests where id=p_quest_id),p_quest_id);
end $$;

-- 송금 전에 퀘스트 모임 참석자에게 운영팀(지금 로그인한 관리자 계정)이 앱 안 메시지로 직접 묻는다.
create function public.ask_admin_host_quest_attendee(p_quest_id uuid, p_person_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare q private.host_quests; existing private.host_quest_payout_checks; v_session uuid; title text; zone text; starts timestamptz; conversation uuid;
begin
  perform private.assert_host_quest_admin();
  select * into q from private.host_quests where id=p_quest_id;
  if q.id is null then raise exception 'QUEST_NOT_FOUND'; end if;
  select * into existing from private.host_quest_payout_checks where quest_id=q.id and person_id=p_person_id;
  if existing.quest_id is not null then return existing.conversation_id; end if;
  select st.session_ids[1] into v_session from private.host_quest_steps st
    where st.quest_id=q.id and st.step in (2,5,7) and st.status<>'cancelled' and p_person_id=any(st.person_ids) order by st.step limit 1;
  if v_session is null then raise exception 'INVALID_ATTENDEE'; end if;
  if (select count(*) from private.host_quest_payout_checks where quest_id=q.id)>=6 then raise exception 'CHECK_LIMIT'; end if;
  select p.title, coalesce(c.timezone,'America/Vancouver'), s.starts_at into title, zone, starts
    from private.meetup_sessions s join public.posts p on p.id=s.post_id left join public.cities c on c.id=p.city_id where s.id=v_session;
  conversation:=public.start_conversation(p_person_id,null);
  perform public.send_message(conversation,
    '안녕하세요, 글링 운영팀이에요. '||to_char(starts at time zone zone,'FMMM"월" FMDD"일"')||' 「'||left(title,60)||'」에 다녀오셨어요? 「네」, 「아니요」로만 답장 주셔도 돼요.');
  insert into private.host_quest_payout_checks(quest_id,person_id,session_id,conversation_id,asked_by) values(q.id,p_person_id,v_session,conversation,auth.uid());
  perform public.log_admin_access('host_quests',q.user_id,q.id);
  return conversation;
end $$;

create function public.record_admin_host_quest_check(p_quest_id uuid, p_person_id uuid, p_answer text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_host_quest_admin();
  if p_answer is null or p_answer not in ('yes','no','none') then raise exception 'INVALID_ANSWER'; end if;
  update private.host_quest_payout_checks set answer=p_answer, answered_at=now(), answered_by=auth.uid()
    where quest_id=p_quest_id and person_id=p_person_id;
  if not found then raise exception 'CHECK_NOT_FOUND'; end if;
  perform public.log_admin_access('host_quests',(select user_id from private.host_quests where id=p_quest_id),p_quest_id);
end $$;

-- "보냄"은 사진 속 사람 수, 참석자 2명 '다녀왔어요' 답, 코드 받은 사람 이름 = 받는 이름, 은행 화면 이름 확인이 다 있어야 된다.
create function public.settle_admin_host_quest_payout(p_quest_id uuid, p_action text, p_transfer_last4 text default null,
  p_bank_name_matched boolean default false, p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare q private.host_quests; pay private.host_quest_payouts; c private.host_quest_codes; note text:=left(nullif(btrim(coalesce(p_note,'')),''),300);
begin
  perform private.assert_host_quest_admin();
  if p_action is null or p_action not in ('sent','held') then raise exception 'INVALID_ACTION'; end if;
  select * into q from private.host_quests where id=p_quest_id for update;
  if q.id is null then raise exception 'QUEST_NOT_FOUND'; end if;
  select * into pay from private.host_quest_payouts where quest_id=q.id for update;
  if pay.quest_id is null then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if pay.status='sent' then raise exception 'PAYOUT_ALREADY_SENT'; end if;
  if p_action='held' then
    update private.host_quest_payouts set status='held', held_at=now(), held_by=auth.uid(), held_note=note, erase_after=now()+interval '365 days'
      where quest_id=q.id;
  else
    if q.status<>'active' then raise exception 'QUEST_ENDED'; end if;
    if (private.host_quest_totals(q.id)->>'confirmed')::int<2000 then raise exception 'PAYOUT_NOT_READY'; end if;
    if pay.email is null or pay.legal_name is null then raise exception 'PAYOUT_DETAILS_ERASED'; end if;
    if pay.photo_people is null then raise exception 'PHOTO_PEOPLE_REQUIRED'; end if;
    if pay.photo_people<coalesce(private.host_quest_photo_needed(q.id),pay.photo_people+1) then raise exception 'PHOTO_PEOPLE_TOO_FEW'; end if;
    if (select count(*) from private.host_quest_payout_checks where quest_id=q.id and answer='yes')<2 then raise exception 'ATTENDEE_CHECKS_REQUIRED'; end if;
    select * into c from private.host_quest_codes where code=q.code;
    if private.host_quest_name_key(c.recipient_name) is null then raise exception 'RECIPIENT_NAME_REQUIRED'; end if;
    if private.host_quest_name_key(c.recipient_name)<>private.host_quest_name_key(pay.legal_name) then raise exception 'PAYOUT_NAME_MISMATCH'; end if;
    if not coalesce(p_bank_name_matched,false) then raise exception 'BANK_NAME_CHECK_REQUIRED'; end if;
    if coalesce(p_transfer_last4,'') !~ '^[A-Za-z0-9]{4}$' then raise exception 'INVALID_TRANSFER_REFERENCE'; end if;
    update private.host_quest_payouts set status='sent', sent_at=now(), sent_by=auth.uid(), transfer_last4=p_transfer_last4, amount_cents=least((private.host_quest_totals(q.id)->>'confirmed')::int,2000),
      held_note=coalesce(note,held_note), erase_after=now()+interval '365 days' where quest_id=q.id;
    update private.host_quests set status='paid', finished_at=now() where id=q.id;
  end if;
  perform public.log_admin_access('host_quests',q.user_id,q.id);
end $$;

-- 권한 -------------------------------------------------------------------
revoke all on function private.mark_meetup_check_in_method(),
  private.host_quest_name_key(text), private.host_quest_session_problem(uuid), private.host_quest_session_ok(uuid,uuid),
  private.host_quest_session_people(uuid,uuid), private.host_quest_counted(uuid,uuid), private.host_quest_invitee(uuid,uuid),
  private.host_quest_totals(uuid), private.host_quest_photo_needed(uuid), private.host_quest_set_step(uuid,int,int,uuid[],uuid[],uuid,uuid), private.evaluate_host_quest(uuid),
  private.convert_host_quest(uuid,text), private.settle_host_quest(uuid), private.run_host_quests(), private.purge_host_quest_account_data(uuid),
  private.can_upload_host_quest_photo(text), private.can_read_host_quest_photo(text), private.assert_host_quest_admin()
  from public, anon, authenticated, service_role;
grant execute on function private.can_upload_host_quest_photo(text), private.can_read_host_quest_photo(text) to authenticated;
revoke all on function public.get_meetup_check_in_qr(uuid), public.check_in_meetup_qr(uuid,text), public.start_host_quest(text,boolean),
  public.get_my_host_quest(), public.request_host_quest_payout(text,text), public.submit_host_quest_photo(uuid,text),
  public.claim_host_quest_photo_cleanup(integer), public.finish_host_quest_photo_cleanup(uuid[]),
  public.get_admin_host_quests(), public.get_admin_host_quest(uuid), public.create_admin_host_quest_codes(integer,text),
  public.set_admin_host_quest_code(text,text,text), public.set_admin_host_quest_accepting(boolean),
  public.review_admin_host_quest_photo(uuid,boolean,text), public.decide_admin_host_quest_step(bigint,boolean,text),
  public.end_admin_host_quest(uuid,boolean,text), public.set_admin_host_quest_photo_people(uuid,integer),
  public.ask_admin_host_quest_attendee(uuid,uuid), public.record_admin_host_quest_check(uuid,uuid,text),
  public.settle_admin_host_quest_payout(uuid,text,text,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_meetup_check_in_qr(uuid), public.check_in_meetup_qr(uuid,text), public.start_host_quest(text,boolean),
  public.get_my_host_quest(), public.request_host_quest_payout(text,text), public.submit_host_quest_photo(uuid,text),
  public.get_admin_host_quests(), public.get_admin_host_quest(uuid), public.create_admin_host_quest_codes(integer,text),
  public.set_admin_host_quest_code(text,text,text), public.set_admin_host_quest_accepting(boolean),
  public.review_admin_host_quest_photo(uuid,boolean,text), public.decide_admin_host_quest_step(bigint,boolean,text),
  public.end_admin_host_quest(uuid,boolean,text), public.set_admin_host_quest_photo_people(uuid,integer),
  public.ask_admin_host_quest_attendee(uuid,uuid), public.record_admin_host_quest_check(uuid,uuid,text),
  public.settle_admin_host_quest_payout(uuid,text,text,boolean,text)
  to authenticated;
grant execute on function public.claim_host_quest_photo_cleanup(integer), public.finish_host_quest_photo_cleanup(uuid[]) to service_role;

-- 보관 기간(하루 한 번). 송금 기록(송금일·금액·이체 번호 끝 4자리)은 세무 기록이라 송금한 해(밴쿠버 기준)가 끝나고 6년,
-- 한 사람 확인용 해시와 참여 기록은 프로그램이 끝난 날부터 1년 뒤 지운다. 보관 중인 송금 기록이 붙은 퀘스트 줄만 남긴다.
create function private.purge_host_quest_records() returns jsonb
language plpgsql security definer set search_path='' as $$
declare ended timestamptz:=(select ended_at from private.host_quest_program where id); payouts integer; quests integer:=0;
begin
  delete from private.host_quest_payouts p where p.status='sent'
    and now()>=(date_trunc('year',p.sent_at at time zone 'America/Vancouver')+interval '7 years') at time zone 'America/Vancouver';
  get diagnostics payouts=row_count;
  if ended is not null and now()>=ended+interval '1 year' then
    delete from private.host_quest_people;
    update private.meetup_attendance set check_in_device=null where check_in_device is not null;
    delete from private.host_quest_photos where deleted_at is not null;
    delete from private.host_quests q where not exists(select 1 from private.host_quest_payouts p where p.quest_id=q.id and p.status='sent');
    get diagnostics quests=row_count;
    delete from private.host_quest_steps;
    delete from private.host_quest_payout_checks;
    update private.host_quest_payouts set email=null, legal_name=null, email_mark=null, photo_people=null, held_note=null,
      erased_at=coalesce(erased_at,now()) where email_mark is not null or email is not null or legal_name is not null;
    delete from private.host_quest_codes c where not exists(select 1 from private.host_quests q where q.code=c.code);
    update private.host_quest_codes set recipient_name=null, note=null where recipient_name is not null or note is not null;
  end if;
  return jsonb_build_object('payouts',payouts,'quests',quests);
end $$;
revoke all on function private.purge_host_quest_records() from public, anon, authenticated, service_role;

-- 30분마다 판정·확정·60일 정리, 하루 한 번 사진 지우기(푸시 발송과 같은 예약 호출 비밀값을 쓴다).
select cron.schedule('host-quests-settle','*/30 * * * *','select private.run_host_quests()');
select cron.schedule('host-quest-photo-cleanup','40 10 * * *', $job$
  select private.purge_host_quest_records();
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gling_push_project_url') || '/functions/v1/quest-photo-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gling_push_notifications_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$job$);

-- 모르는 분석 대상은 묶음 전체를 거절하므로, 앱 빌드보다 먼저 운영에 들어가야 한다.
insert into private.behavior_targets(id) values
  ('profile.host-quest'),('host-quest.scroll'),('host-quest.agree'),('host-quest.start'),('host-quest.step'),('host-quest.payout'),
  ('host-quest-step.scroll'),('host-quest-step.invite'),('host-quest-payout.scroll'),('host-quest-payout.request'),
  ('meetup.quest.qr'),('meetup.quest.photo'),('meetup.quest.photo.shoot'),
  ('checkin.home'),('checkin.login'),('checkin.open_meetup'),('checkin.open_app')
on conflict (id) do nothing;
