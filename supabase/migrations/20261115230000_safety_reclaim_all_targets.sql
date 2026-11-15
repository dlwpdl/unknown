-- 안전 점검 도중 끊긴 글·댓글도 대화 메시지처럼 5분 뒤 다시 잡는다 (owner 2026-11-15 "자동 재수거 PR").
-- 지금까지는 메시지만 다시 잡아서, 끊긴 글·댓글은 'processing'에 영영 남았다.
-- 다시 잡을 때마다 claim_safety_reviews가 attempts를 올리므로 5번에서 멈춘다.
-- 늦게 끝난 옛 작업은 complete_safety_review가 'processing'이 아니면 받지 않는다.

create or replace function public.claim_safety_reviews_v2(p_limit integer default 20)
returns table(id bigint,target_type text,target_id uuid,content_hash text,claimed_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare item record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  -- Reclaim abandoned leases of every target type in the same scheduled run; stale message completions cannot advance them.
  update public.safety_review_queue q set status='failed',next_attempt_at=now(),last_error='REVIEW_LEASE_EXPIRED'
    where q.status='processing' and q.updated_at<now()-interval '5 minutes';
  for item in select * from public.claim_safety_reviews(p_limit) loop
    return query update public.safety_review_queue q set updated_at=clock_timestamp() where q.id=item.id
      returning q.id,q.target_type,q.target_id,q.content_hash,q.updated_at;
  end loop;
end;
$$;

-- Mirrors public.claim_safety_reviews_v2: abandoned leases it reclaims, then rows claim_safety_reviews selects.
create or replace function private.safety_work_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.safety_review_queue q
                where q.status in ('pending', 'failed') and coalesce(q.next_attempt_at, now()) <= now() and q.attempts < 5)
      or exists(select 1 from public.safety_review_queue q
                where q.status = 'processing' and q.updated_at < now() - interval '5 minutes');
$$;
