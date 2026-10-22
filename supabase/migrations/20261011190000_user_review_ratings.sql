-- Keep the legacy response for installed clients; new user reviews use explicit ten-point ratings.
alter table private.trust_reviews drop constraint trust_reviews_check1;
alter table private.trust_reviews add constraint trust_reviews_check1 check(
  (kind='meetup' and session_id is not null and subject_id is null and score is not null and signals is null)
  or (kind='manner' and subject_id is not null and subject_id<>author_id and signals is not null));

create function public.write_user_review(p_session_id uuid,p_conversation_id uuid,p_subject_id uuid,p_signals jsonb,p_score numeric,p_body text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare review_id uuid; existing private.trust_reviews;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid()); perform private.lock_relationships();
  if p_score is null or p_score not between 1 and 10 or p_score*2<>trunc(p_score*2) then raise exception 'INVALID_REVIEW'; end if;
  if p_score<=5 and char_length(btrim(coalesce(p_body,'')))<10 then raise exception 'REVIEW_REASON_REQUIRED'; end if;
  select * into existing from private.trust_reviews where kind='manner' and author_id=auth.uid() and subject_id=p_subject_id
    and session_id is not distinct from p_session_id and conversation_id is not distinct from p_conversation_id;
  if existing.id is not null and existing.score is distinct from p_score then raise exception 'REVIEW_ALREADY_SUBMITTED'; end if;
  review_id:=public.write_manner_review(p_session_id,p_conversation_id,p_subject_id,p_signals,p_body);
  if existing.id is null then
    update private.trust_reviews set score=p_score,status=case when p_score<=5 then 'needs_review' else status end,
      updated_at=clock_timestamp() where id=review_id;
  end if;
  return review_id;
end;
$$;
revoke all on function public.write_user_review(uuid,uuid,uuid,jsonb,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.write_user_review(uuid,uuid,uuid,jsonb,numeric,text) to authenticated;
alter function public.write_user_review(uuid,uuid,uuid,jsonb,numeric,text) owner to postgres;

create or replace function public.get_manner_summary(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with latest as (
    select distinct on (r.author_id,(r.session_id is not null)) r.author_id,r.session_id,r.signals,r.score
    from private.trust_reviews r
    where r.kind='manner' and r.subject_id=p_user_id and r.status='published' and private.trust_review_released(r)
      and r.created_at>=now()-interval '30 days' and private.is_active_account(r.author_id)
      and private.is_active_account(p_user_id) and not private.is_blocked_between(auth.uid(),p_user_id)
    order by r.author_id,(r.session_id is not null),r.created_at desc,r.id desc
  ), legacy as (
    select session_id is not null meeting,count(distinct author_id)::integer participants,
      round(100.0*count(*) filter(where v.value='true'::jsonb)/nullif(count(*) filter(where jsonb_typeof(v.value)='boolean'),0),0) score
    from latest cross join lateral jsonb_each(signals) v group by session_id is not null
  ), ratings as (
    select session_id is not null meeting,count(*)::integer participants,round(avg(score),1) score
    from latest where score is not null group by session_id is not null
  ), parts as (
    select meeting,jsonb_build_object('participants',coalesce(l.participants,0),'score',case when l.participants>=5 then l.score end,
      'rating',jsonb_build_object('participants',coalesce(r.participants,0),'score',case when r.participants>=5 then r.score end)) part
    from (values(true),(false)) contexts(meeting) left join legacy l using(meeting) left join ratings r using(meeting)
  ) select jsonb_build_object('meeting',(select part from parts where meeting),'chat',(select part from parts where not meeting));
$$;

do $$
declare definition text; anchor text:='''signals'',r.signals';
begin
  definition:=pg_get_functiondef('public.get_my_manner_feedback()'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'USER_REVIEW_FEEDBACK_CHANGED'; end if;
  execute replace(definition,anchor,'''score'',r.score,'||anchor);
end;
$$;
notify pgrst,'reload schema';
