-- A report hides only its target for its reporter. A block hides the author.
-- Moderation is separate: no original body is deleted by any of these actions.
alter table public.reports
  add column source text not null default 'report' check (source in ('report', 'block')),
  add column blocked_at timestamptz,
  add column evidence jsonb;
alter table public.messages add column hidden_at timestamptz;
-- The existing unique(reporter_id, target_type, target_id) indexes personal hides.

create function private.has_reported(p_viewer uuid, p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reports r
    where r.reporter_id = p_viewer and r.target_type = p_type and r.target_id = p_id);
$$;
revoke all on function private.has_reported(uuid,text,uuid) from public, anon, authenticated;
grant execute on function private.has_reported(uuid,text,uuid) to authenticated;

-- Save the version that was reported, even if the author edits it afterwards.
create function private.capture_report_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  case new.target_type
    when 'post' then select to_jsonb(p) into new.evidence from public.posts p where p.id = new.target_id;
    when 'comment' then select to_jsonb(c) into new.evidence from public.comments c where c.id = new.target_id;
    when 'message' then select to_jsonb(m) into new.evidence from public.messages m where m.id = new.target_id;
    when 'user' then select jsonb_build_object('id',p.id,'nickname',p.nickname)
      into new.evidence from public.profiles p where p.id = new.target_id;
  end case;
  return new;
end;
$$;
create trigger reports_capture_evidence before insert on public.reports
  for each row execute function private.capture_report_evidence();

-- Reuse the existing admin notification inbox and its delivery pipeline.
create function private.notify_report()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, kind, target_type, target_id, body, route)
  select p.id, 'safety_alert', new.target_type, new.target_id,
    case when new.blocked_at is not null then '사용자 차단이 접수됐어요. 신고함에서 확인해 주세요.'
      else '콘텐츠 신고가 접수됐어요. 신고함에서 원본을 확인해 주세요.' end,
    '/admin?section=reports'
  from public.profiles p join auth.users u on u.id = p.id
  where u.raw_app_meta_data->>'role' = 'admin' and p.account_status = 'active';
  return new;
end;
$$;
create trigger reports_notify_admin after insert on public.reports
  for each row execute function private.notify_report();
create trigger reports_notify_block after update of blocked_at on public.reports
  for each row when (new.blocked_at is distinct from old.blocked_at)
  execute function private.notify_report();

create or replace function private.record_user_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Report-and-block keeps the content evidence in the same queue item.
  update public.reports set blocked_at = new.created_at
  where id = (select id from public.reports where reporter_id = new.blocker_id
    and reported_user_id = new.blocked_id and status = 'open'
    and created_at >= now() - interval '5 minutes' order by created_at desc limit 1);
  if not found then
    insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code,details,source,blocked_at)
    values(new.blocker_id,new.blocked_id,'user',new.blocked_id,'other',
      '사용자 직접 차단 — 위반 확정 아님. 활동 내역을 검토하세요.','block',new.created_at)
    on conflict (reporter_id,target_type,target_id) do update
      set blocked_at = excluded.blocked_at, status = 'open', resolved_at = null, resolved_by = null;
  end if;
  return new;
end;
$$;
create trigger blocks_report_admin after insert on public.blocks
  for each row execute function private.record_user_block();
revoke all on function private.capture_report_evidence(), private.notify_report(), private.record_user_block()
  from public, anon, authenticated;

-- Direct table reads preserve the audited admin path.
create policy "reporter hides posts" on public.posts as restrictive for select to authenticated
  using ((select private.is_admin()) or not private.has_reported((select auth.uid()),'post',id));
create policy "reporter hides messages" on public.messages as restrictive for select to authenticated
  using ((select private.is_admin()) or (hidden_at is null
    and not private.has_reported((select auth.uid()),'message',id)
    and not private.is_blocked_between((select auth.uid()),sender_id)));

-- Patch the established visibility helpers/queries without copying their unrelated
-- pagination, listing, ranking and permission logic. Fail if an expected anchor drifts.
do $$
declare signature text; definition text; original text; anchor text;
begin
  foreach signature in array array[
    'public.get_public_feed(text,integer)',
    'public.get_public_feed_page_v2(text,smallint,text,timestamptz,uuid,integer)',
    'public.get_public_feed_page(text,smallint,text,timestamptz,uuid,integer)',
    'public.get_public_post(uuid)',
    'public.get_saved_posts(timestamptz,uuid,integer)',
    'public.get_trending_hashtags(text,smallint,integer,integer)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure); original := definition;
    anchor := 'not private.is_blocked_between(auth.uid(), post.author_id)';
    definition := replace(definition, anchor, anchor || ' and not private.has_reported(auth.uid(), ''post'', post.id)');
    if definition = original then raise exception 'Missing visibility anchor: %', signature; end if;
    execute definition;
  end loop;

  definition := pg_get_functiondef('private.comment_visible_to(uuid,uuid)'::regprocedure);
  anchor := 'where c.id = p_comment_id and c.deleted_at is null';
  if position(anchor in definition) = 0 then raise exception 'Missing comment visibility anchor'; end if;
  definition := replace(definition, anchor, anchor || '
    and not private.has_reported(p_user_id, ''comment'', c.id)
    and not private.has_reported(p_user_id, ''post'', p.id)');
  definition := replace(definition, 'ancestor.deleted_at is not null',
    'private.has_reported(p_user_id, ''comment'', ancestor.id) or ancestor.deleted_at is not null');
  execute definition;

  definition := pg_get_functiondef('public.get_weekly_ranking(text)'::regprocedure);
  anchor := 'not private.is_blocked_between((select auth.uid()), p.author_id)';
  if position(anchor in definition) = 0 then raise exception 'Missing ranking visibility anchor'; end if;
  definition := replace(definition, anchor, anchor || ' and not private.has_reported(auth.uid(), ''post'', p.id)');
  execute replace(definition, '''nickname'', author.nickname', '''authorId'', p.author_id, ''nickname'', author.nickname');

  definition := pg_get_functiondef('public.get_trade_profile(uuid)'::regprocedure);
  anchor := 'and p.listing_status = ''open''';
  if position(anchor in definition) = 0 then raise exception 'Missing trade visibility anchor'; end if;
  execute replace(definition, anchor, anchor || ' and not private.has_reported(viewer, ''post'', p.id)');

  foreach signature in array array[
    'public.get_conversation_inbox(text,integer,text,timestamptz,uuid,uuid)',
    'public.get_conversation_previews(integer,timestamptz,uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    anchor := 'where m.conversation_id=c.id';
    if position(anchor in definition) = 0 then raise exception 'Missing inbox visibility anchor: %', signature; end if;
    execute replace(definition, anchor, anchor || ' and m.hidden_at is null
      and not private.has_reported(auth.uid(), ''message'', m.id)
      and not private.is_blocked_between(auth.uid(), m.sender_id)');
  end loop;

  definition := pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  definition := replace(definition, 'where p.id = p_target_id',
    'where p.id = p_target_id and not private.has_reported(p_user_id, ''post'', p.id)');
  definition := replace(definition, 'where m.id = p_target_id',
    'where m.id = p_target_id and m.hidden_at is null and not private.has_reported(p_user_id, ''message'', m.id)');
  execute definition;
end;
$$;

-- Add content-only moderation; retain existing warning/account suspension behavior.
alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in ('dismissed','warned','blocked','hidden'));
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.moderate_report(uuid,text,text)'::regprocedure);
  if position('if p_action = ''warned'' then' in definition) = 0 then raise exception 'Missing moderation anchor'; end if;
  definition := replace(definition, '(''dismissed'', ''warned'', ''blocked'')', '(''dismissed'', ''warned'', ''blocked'', ''hidden'')');
  definition := replace(definition, 'if p_action = ''warned'' then', '
  perform public.log_admin_access(''reports'', report.reported_user_id, report.id);
  if p_action = ''hidden'' then
    case report.target_type
      when ''post'' then update public.posts set status = ''removed'' where id = report.target_id;
      when ''comment'' then update public.comments set deleted_at = now() where id = report.target_id;
      when ''message'' then update public.messages set hidden_at = now() where id = report.target_id;
      else raise exception ''CONTENT_TARGET_REQUIRED'';
    end case;
  elsif p_action = ''warned'' then');
  execute definition;
end;
$$;
