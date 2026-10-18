-- New clients must not publish through a server that still exposes personal business authors.
do $$
begin
  if to_regprocedure('private.public_post_business_id_for(uuid,uuid)') is null then
    raise exception 'BUSINESS_PRIVACY_MIGRATION_REQUIRED';
  end if;
end;
$$;

create function public.publish_merchant_workspace_draft(
  p_merchant_id uuid,p_draft_id uuid,p_expected_updated_at timestamptz,p_require_business_privacy boolean
) returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if p_require_business_privacy is distinct from true then
    raise exception 'BUSINESS_PRIVACY_REQUIRED';
  end if;
  return public.publish_merchant_workspace_draft(p_merchant_id,p_draft_id,p_expected_updated_at);
end;
$$;
alter function public.publish_merchant_workspace_draft(uuid,uuid,timestamptz,boolean) owner to postgres;
revoke all on function public.publish_merchant_workspace_draft(uuid,uuid,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function public.publish_merchant_workspace_draft(uuid,uuid,timestamptz,boolean) to authenticated;
notify pgrst,'reload schema';
