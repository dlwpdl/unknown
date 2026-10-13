-- Reuse the established erasure path, including retries after a failed final auth deletion.
create function private.purge_trust_account_data(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare owned_post_ids uuid[]; conversation_ids uuid[]; session_ids uuid[]; attendance_ids uuid[]; review_ids uuid[];
begin
 if p_user_id is null or p_user_id is distinct from auth.uid() then raise exception 'AUTH_REQUIRED'; end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into owned_post_ids from public.posts where author_id=p_user_id;
 select coalesce(array_agg(id),'{}'::uuid[]) into conversation_ids from public.conversations
   where p_user_id in(user_low_id,user_high_id) or group_post_id=any(owned_post_ids);
 select coalesce(array_agg(id),'{}'::uuid[]) into session_ids from private.meetup_sessions
   where host_id=p_user_id or post_id=any(owned_post_ids);
 select coalesce(array_agg(id),'{}'::uuid[]) into attendance_ids from private.meetup_attendance
   where user_id=p_user_id or session_id=any(session_ids);
 select coalesce(array_agg(id),'{}'::uuid[]) into review_ids from private.trust_reviews
   where author_id=p_user_id or subject_id=p_user_id or session_id=any(session_ids) or conversation_id=any(conversation_ids);
 delete from public.notifications
   where (target_type in('meetup_review','manner_review') and target_id=any(review_ids))
     or (target_type='meetup_attendance' and target_id=any(attendance_ids))
     or (target_type='meetup_session' and target_id=any(session_ids));
 delete from public.safety_review_queue
   where (target_type in('meetup_review','manner_review') and target_id=any(review_ids))
     or (target_type='meetup_attendance' and target_id=any(attendance_ids));
 delete from public.safety_alerts
   where (target_type in('meetup_review','manner_review') and target_id=any(review_ids))
     or (target_type='meetup_attendance' and target_id=any(attendance_ids));
 delete from public.moderation_actions where report_id in(select id from public.reports
   where (target_type in('meetup_review','manner_review') and target_id=any(review_ids))
     or (target_type='meetup_attendance' and target_id=any(attendance_ids)));
 delete from public.reports
   where (target_type in('meetup_review','manner_review') and target_id=any(review_ids))
     or (target_type='meetup_attendance' and target_id=any(attendance_ids));
 delete from public.admin_access_logs
   where resource_id=any(review_ids) or resource_id=any(attendance_ids) or resource_id=any(session_ids);
 -- Existing policy also removes administrator-authored access and action records on erasure.
 delete from private.trust_review_decisions
   where admin_id=p_user_id
     or (target_type in('meetup_review','manner_review') and target_id=any(review_ids))
     or (target_type='meetup_attendance' and target_id=any(attendance_ids))
     or previous->>'authorId'=p_user_id::text or previous->>'subjectId'=p_user_id::text;
 delete from private.trust_reviews where id=any(review_ids);
 delete from private.meetup_attendance where id=any(attendance_ids);
 delete from private.meetup_review_deliveries where user_id=p_user_id or session_id=any(session_ids);
 delete from private.meetup_sessions where id=any(session_ids);
end;
$$;
alter function private.purge_trust_account_data(uuid) owner to postgres;
revoke all on function private.purge_trust_account_data(uuid) from public,anon,authenticated,service_role;

do $trust_deletion$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
 anchor:='  delete from public.notifications';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'TRUST_ACCOUNT_PURGE_CHANGED'; end if;
 execute replace(definition,anchor,'  perform private.purge_trust_account_data(current_user_id);'||E'\n'||anchor);
 definition:=pg_get_functiondef('public.delete_my_account(text)'::regprocedure);
 anchor:='  if current_status = ''deleted'' then return; end if;';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'TRUST_ACCOUNT_RETRY_CHANGED'; end if;
 execute replace(definition,anchor,'  if current_status = ''deleted'' then perform private.purge_trust_account_data(current_user_id); return; end if;');
end;
$trust_deletion$;
notify pgrst,'reload schema';
