-- Both admin directions read one relationship: creator_deals.merchant_id.
create function public.get_admin_merchant_creator_deals(p_merchant_id uuid,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb; more boolean;
begin
  perform private.lock_partnership_actor();
  if p_merchant_id is null or p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'INVALID_PARTNERSHIP'; end if;
  if not exists(select 1 from private.merchants where id=p_merchant_id and record_kind='business' and deleted_at is null) then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  with page as materialized (select * from private.creator_deals where merchant_id=p_merchant_id
    order by collaboration_on desc nulls last,agreed_on desc,created_at desc,id desc limit 51 offset p_offset)
  select coalesce((select jsonb_agg(private.creator_deal_record(d.id)||jsonb_build_object('creator_name',r.display_name,'creator_profile_url',r.profile_url)
    order by d.collaboration_on desc nulls last,d.agreed_on desc,d.created_at desc,d.id desc)
    from (select * from page order by collaboration_on desc nulls last,agreed_on desc,created_at desc,id desc limit 50)d
    join private.partnership_creators r on r.id=d.creator_id),'[]'),(select count(*)>50 from page) into rows,more;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_merchant_id);
  return jsonb_build_object('merchant_id',p_merchant_id,'rows',rows,'more',more);
end $$;
alter function public.get_admin_merchant_creator_deals(uuid,integer) owner to postgres;
revoke all on function public.get_admin_merchant_creator_deals(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_merchant_creator_deals(uuid,integer) to authenticated;
notify pgrst,'reload schema';
