-- Owner 2026-11-03 "연결안됏지만 보여지는건 어쨋든 그 비즈니스 여야할거같고, 나중에 가입하면 연결시킬수잇게?": job and rental ads copied
-- from cafés have no public link of the business we may show, so the admin can link its own copy without one. Anyone else's
-- post still needs a valid https original link.

create or replace function public.link_admin_merchant_post(p_merchant_id uuid, p_post_id uuid, p_original_url text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare as_business boolean;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if not exists(select 1 from private.merchants where id=p_merchant_id and consent in ('granted','pending')) then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  -- The admin's own copy of a café ad may have no public link of the business to show (the café link stays internal).
  if not private.valid_merchant_original(p_original_url) and not (p_original_url is null
    and exists(select 1 from public.posts where id=p_post_id and author_id=auth.uid())) then raise exception 'INVALID_ORIGINAL_URL'; end if;
  if not exists(select 1 from public.posts p join private.merchants m on m.id=p_merchant_id where p.id=p_post_id and p.city_id=m.city_id and p.status='published') then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
  -- Only the admin's own post moves under the business; anyone else's post stays under its author.
  select m.record_kind='business' and p.author_id=auth.uid()
  into as_business from private.merchants m join public.posts p on p.id=p_post_id where m.id=p_merchant_id;
  insert into private.merchant_posts(merchant_id,post_id,original_url,published_as_business) values(p_merchant_id,p_post_id,p_original_url,as_business)
  on conflict(post_id) do update set original_url=excluded.original_url,updated_at=now(),
    published_as_business=private.merchant_posts.published_as_business or excluded.published_as_business
    where private.merchant_posts.merchant_id=excluded.merchant_id;
  if not found then raise exception 'POST_ALREADY_LINKED'; end if;
  return p_post_id;
end;
$function$;

notify pgrst,'reload schema';
