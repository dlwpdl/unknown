-- An admin's own post linked to a business whose real owner connected their profile shows under the business profile,
-- like the owner's own posts. Posts by anyone else that an admin links stay under their author.
create or replace function public.link_admin_merchant_post(p_merchant_id uuid, p_post_id uuid, p_original_url text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare as_business boolean;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if not exists(select 1 from private.merchants where id=p_merchant_id and consent='granted') then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if not private.valid_merchant_original(p_original_url) then raise exception 'INVALID_ORIGINAL_URL'; end if;
  if not exists(select 1 from public.posts p join private.merchants m on m.id=p_merchant_id where p.id=p_post_id and p.city_id=m.city_id and p.status='published') then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
  select m.record_kind='business' and m.owner_id is not null and m.owner_verified_at is not null and p.author_id=auth.uid()
  into as_business from private.merchants m join public.posts p on p.id=p_post_id where m.id=p_merchant_id;
  insert into private.merchant_posts(merchant_id,post_id,original_url,published_as_business) values(p_merchant_id,p_post_id,p_original_url,as_business)
  on conflict(post_id) do update set original_url=excluded.original_url,updated_at=now(),
    published_as_business=private.merchant_posts.published_as_business or excluded.published_as_business
    where private.merchant_posts.merchant_id=excluded.merchant_id;
  if not found then raise exception 'POST_ALREADY_LINKED'; end if;
  return p_post_id;
end;
$function$;
