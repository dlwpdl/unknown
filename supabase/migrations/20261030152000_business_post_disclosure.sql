-- Posts that show under an owner-verified business but were written by someone else (our admin account) say so, with
-- the same line the admin dashboard's business posts carry. The owner's and operators' own posts are unchanged.
create or replace function private.bind_business_post_identity()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare note constant text:='비즈니스의 허락을 받아 글링에서 대신 게시한 안내입니다.';
begin
  if new.published_as_business then
    update public.posts set business_author_id=new.merchant_id where id=new.post_id
      and (business_author_id is null or business_author_id=new.merchant_id);
    if not found then raise exception 'BUSINESS_IDENTITY_CONFLICT'; end if;
    update public.posts p set body=p.body||E'\n\n'||note from private.merchants m
      where p.id=new.post_id and m.id=new.merchant_id and p.author_id is distinct from m.owner_id
        and not exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=p.author_id)
        and strpos(p.body,'글링에서 대신 게시한 안내')=0;  -- older posts say 업체의 허락을 받아 … at the top
  end if;
  return new;
end $function$;
