-- Keyword-based safety alerts (owner request 2026-09-15, within ADR-0001).
-- AI review is expensive, so every new post/comment/message is also scanned synchronously for a
-- private list of watch terms (drugs, weapons, sexual exploitation, fraud, self-harm, threats,
-- doxxing, illegal status/labour). A match writes an alert, preserves an excerpt as evidence even if
-- the content is later deleted, and notifies admins. Admins review, dismiss, or escalate, and can
-- export an audited evidence bundle for a law-enforcement request. A match is a signal, not a verdict.

alter table public.admin_access_logs drop constraint admin_access_logs_scope_check;
alter table public.admin_access_logs add constraint admin_access_logs_scope_check check (scope in (
  'analytics','dashboard','safety','reports','users','posts','comments','conversations','messages','user_detail','alerts','evidence'));

create table private.watch_terms (
  term text primary key,
  category text not null check (category in ('drugs','weapons','sexual_exploitation','fraud','self_harm','violence','doxxing','illegal_status')),
  severity text not null check (severity in ('medium','high','critical')),
  active boolean not null default true
);
insert into private.watch_terms (term, category, severity) values
  ('대마','drugs','critical'),('마리화나','drugs','critical'),('필로폰','drugs','critical'),('히로뽕','drugs','critical'),
  ('코카인','drugs','critical'),('엑스터시','drugs','critical'),('케타민','drugs','critical'),('펜타닐','drugs','critical'),
  ('마약','drugs','high'),('fentanyl','drugs','critical'),('meth','drugs','high'),('cocaine','drugs','critical'),
  ('총기','weapons','critical'),('권총','weapons','critical'),('실탄','weapons','critical'),('사제총','weapons','critical'),
  ('폭탄제조','weapons','critical'),('총팔','weapons','critical'),('총구해','weapons','critical'),
  ('조건만남','sexual_exploitation','critical'),('성매매','sexual_exploitation','critical'),('스폰구함','sexual_exploitation','critical'),
  ('미성년자','sexual_exploitation','high'),('출장마사지','sexual_exploitation','high'),('escort','sexual_exploitation','high'),
  ('선입금','fraud','high'),('대포통장','fraud','critical'),('계좌대여','fraud','critical'),('통장대여','fraud','critical'),
  ('원금보장','fraud','high'),('수익보장','fraud','high'),('보증금먼저','fraud','medium'),('e-transfer먼저','fraud','medium'),
  ('자살','self_harm','critical'),('자해','self_harm','critical'),('죽고싶','self_harm','critical'),
  ('죽여버','violence','critical'),('살인','violence','high'),('칼로찌','violence','critical'),('찾아가서죽','violence','critical'),
  ('신상털','doxxing','high'),('집주소공개','doxxing','high'),('전화번호공개','doxxing','medium'),
  ('불법체류','illegal_status','medium'),('위장결혼','illegal_status','high'),('가짜서류','illegal_status','high'),('여권압수','illegal_status','critical'),('서류위조','illegal_status','high');
revoke all on private.watch_terms from public, anon, authenticated;

create table public.safety_alerts (
  id bigint generated always as identity primary key,
  kind text not null default 'keyword' check (kind in ('keyword')),
  target_type text not null check (target_type in ('post','comment','message')),
  target_id uuid not null,
  author_id uuid not null,
  conversation_id uuid,
  category text not null,
  severity text not null check (severity in ('medium','high','critical')),
  matched_terms text[] not null,
  excerpt text not null,
  status text not null default 'open' check (status in ('open','reviewed','dismissed','escalated')),
  note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (target_type, target_id)
);
create index safety_alerts_open_idx on public.safety_alerts (status, created_at desc);
alter table public.safety_alerts enable row level security;
create policy safety_alerts_admin_read on public.safety_alerts for select to authenticated using ((select private.is_admin()));
revoke insert, update, delete on public.safety_alerts from anon, authenticated;

create function private.scan_watch_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_json jsonb := to_jsonb(new); -- posts/comments/messages differ in columns; read through jsonb like 0020
  content text := concat_ws(' ', row_json->>'title', new.body);
  compact text := regexp_replace(lower(normalize(coalesce(content,''), NFKC)), '[[:space:][:punct:]]+', '', 'g');
  hits text[]; top_severity text; top_category text; author uuid; conv uuid;
begin
  select array_agg(term order by case severity when 'critical' then 0 when 'high' then 1 else 2 end, term),
         (array_agg(severity order by case severity when 'critical' then 0 when 'high' then 1 else 2 end))[1],
         (array_agg(category order by case severity when 'critical' then 0 when 'high' then 1 else 2 end))[1]
  into hits, top_severity, top_category
  from private.watch_terms w where w.active and position(regexp_replace(lower(w.term), '[[:space:][:punct:]]+', '', 'g') in compact) > 0;
  if hits is null then return new; end if;
  author := coalesce((row_json->>'sender_id')::uuid, (row_json->>'author_id')::uuid);
  conv := (row_json->>'conversation_id')::uuid;
  insert into public.safety_alerts (target_type, target_id, author_id, conversation_id, category, severity, matched_terms, excerpt)
  values (case tg_table_name when 'posts' then 'post' when 'comments' then 'comment' else 'message' end, new.id, author, conv,
          top_category, top_severity, hits, left(content, 600))
  on conflict (target_type, target_id) do nothing;
  -- Same admin notification channel the AI reviewer uses (0013).
  insert into public.notifications (user_id, kind, target_type, target_id, body, route)
  select profile.id, 'safety_alert', case tg_table_name when 'posts' then 'post' when 'comments' then 'comment' else 'message' end, new.id,
    case top_severity when 'critical' then '감시어(긴급)가 포함된 콘텐츠가 올라왔어요. 즉시 확인이 필요합니다.' else '감시어가 포함된 콘텐츠가 올라왔어요. 확인해 주세요.' end,
    '/admin?alert=1'
  from public.profiles profile join auth.users u on u.id = profile.id
  where u.raw_app_meta_data->>'role' = 'admin' and profile.account_status = 'active';
  return new;
end;
$$;
revoke all on function private.scan_watch_terms() from public, anon, authenticated;
create trigger posts_watch_terms after insert on public.posts for each row execute function private.scan_watch_terms();
create trigger comments_watch_terms after insert on public.comments for each row execute function private.scan_watch_terms();
create trigger messages_watch_terms after insert on public.messages for each row execute function private.scan_watch_terms();

create function public.resolve_admin_safety_alert(p_alert_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status not in ('reviewed','dismissed','escalated','open') then raise exception 'INVALID_ALERT_STATUS'; end if;
  perform public.log_admin_access('alerts', null, null);
  update public.safety_alerts set status = p_status, note = left(p_note, 1000), reviewed_by = auth.uid(), reviewed_at = now() where id = p_alert_id;
  if not found then raise exception 'ALERT_NOT_FOUND'; end if;
end;
$$;

-- Evidence bundle for an authority request: full content, author identity as stored, retained session
-- IPs/user agents, and (for messages) the surrounding conversation. Every export is audited.
create function public.export_admin_safety_evidence(p_alert_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.safety_alerts; content jsonb; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into a from public.safety_alerts where id = p_alert_id;
  if a.id is null then raise exception 'ALERT_NOT_FOUND'; end if;
  perform public.log_admin_access('evidence', a.author_id, a.target_id);
  content := case a.target_type
    when 'post' then (select to_jsonb(p) from public.posts p where p.id = a.target_id)
    when 'comment' then (select to_jsonb(c) from public.comments c where c.id = a.target_id)
    else (select to_jsonb(m) from public.messages m where m.id = a.target_id) end;
  select jsonb_build_object(
    'exported_at', now(), 'exported_by', auth.uid(), 'alert', to_jsonb(a),
    'content', coalesce(content, jsonb_build_object('deleted', true, 'excerpt', a.excerpt)),
    'author', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'providers', (select jsonb_agg(i.provider) from auth.identities i where i.user_id = u.id),
        'nickname', pr.nickname, 'city_id', pr.city_id, 'verification_level', pr.verification_level, 'account_status', pr.account_status)
      from auth.users u join public.profiles pr on pr.id = u.id where u.id = a.author_id),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('ip', host(s.ip), 'user_agent', s.user_agent, 'created_at', s.created_at, 'refreshed_at', s.refreshed_at) order by s.created_at desc), '[]')
      from auth.sessions s where s.user_id = a.author_id),
    'conversation', case when a.conversation_id is null then null else (select jsonb_agg(jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
      from (select * from public.messages m where m.conversation_id = a.conversation_id order by m.created_at desc limit 100) m) end
  ) into result;
  return result;
end;
$$;
revoke all on function public.resolve_admin_safety_alert(bigint, text, text), public.export_admin_safety_evidence(bigint) from public, anon, authenticated;
grant execute on function public.resolve_admin_safety_alert(bigint, text, text), public.export_admin_safety_evidence(bigint) to authenticated;
