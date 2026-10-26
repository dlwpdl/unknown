-- Businesses Gling introduced with their consent belong in 비즈니스 찾기 (owner 2026-10-26 "그럼 채워야지").
-- They were stored as 'source' records, which the directory skips; list them like the other consenting businesses.
update private.merchants m set record_kind='business',
  status=case when m.status='lead' then 'trial' else m.status end, updated_at=now()
where m.record_kind='source' and m.deleted_at is null and m.consent='granted' and m.status<>'paused'
  and exists(select 1 from private.merchant_posts x join public.posts p on p.id=x.post_id where x.merchant_id=m.id and p.deleted_at is null);
