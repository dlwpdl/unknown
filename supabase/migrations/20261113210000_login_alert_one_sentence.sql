-- A sign-in alert reads as one sentence, in the inbox and in the push (owner 2026-11-13 "서버까지 맞추기", QA E31-1).
-- Same function as 0153 except the new_login body, which now matches new_device. Rows already stored keep their text;
-- the app's inbox still shows the old new_login text as this sentence (src/lib/notification-copy.ts).
create or replace function private.flush_account_security_logins(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare pending private.account_security_sessions; event private.account_security_events; body text; total integer:=0;
begin
  for pending in select * from private.account_security_sessions where not baseline and handled_at is null
    and captured_at<=p_now-interval '1 minute' order by captured_at limit 100 for update skip locked loop
    perform private.record_account_security_event(pending.user_id,'new_login',pending.event_id);
    update private.account_security_sessions set handled_at=p_now where session_id=pending.session_id;
    total:=total+1;
  end loop;
  -- Capture is durable inside Auth; the existing worker owns fallible inbox/queue delivery.
  for event in select * from private.account_security_events where delivered_at is null
    order by created_at limit 100 for update skip locked loop
    body:=case event.kind when 'new_device' then '새 기기 또는 브라우저에서 로그인했어요. 본인이 아니라면 계정 설정을 확인해 주세요.'
      when 'new_login' then '새 기기 또는 브라우저에서 로그인했어요. 본인이 아니라면 계정 설정을 확인해 주세요.'
      when 'email_changed' then '계정 이메일이 변경됐어요. 본인이 아니라면 계정 설정을 확인해 주세요.'
      when 'password_changed' then '계정 비밀번호가 변경됐어요. 본인이 아니라면 계정 설정을 확인해 주세요.' end;
    perform private.create_notification(event.user_id,'account_security',null,'account_security',event.id,body,'/profile/settings');
    update private.account_security_events set delivered_at=p_now where id=event.id;
  end loop;
  return total;
end;
$$;

-- The alert opens settings, which now has "sign out on all devices" (security review on PR #176). Its tap is an analytics target.
insert into private.behavior_targets(id) values ('app_profile_settings.sign-out-all') on conflict do nothing;
