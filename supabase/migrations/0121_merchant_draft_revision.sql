-- Confirm the exact reviewed revision under the existing row lock before approving/publishing.
-- Defaults preserve RPC lookup for older clients, but missing revisions cannot publish new content.
drop function public.approve_merchant_workspace_drafts(uuid,uuid[],boolean);
drop function public.publish_merchant_workspace_draft(uuid,uuid);
drop function public.record_merchant_external_post(uuid,uuid,text);

create function public.approve_merchant_workspace_drafts(p_merchant_id uuid,p_ids uuid[],p_approve boolean,p_expected_updated_at jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare changed int;
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if p_ids is null or p_approve is null or cardinality(p_ids) not between 1 and 50 or array_position(p_ids,null) is not null
    or (select count(distinct x) from unnest(p_ids)x)<>cardinality(p_ids) then raise exception 'INVALID_MERCHANT_DRAFT_SELECTION'; end if;
  if p_approve and cardinality(p_ids)>1 then perform private.assert_merchant_workspace(p_merchant_id,true); end if;
  if p_approve then
    perform 1 from private.merchant_workspace_drafts where merchant_id=p_merchant_id and id=any(p_ids) order by id for update;
    if jsonb_typeof(p_expected_updated_at) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(p_expected_updated_at))<>cardinality(p_ids)
      or exists(select 1 from private.merchant_workspace_drafts d where d.merchant_id=p_merchant_id and d.id=any(p_ids)
        and d.updated_at is distinct from (p_expected_updated_at->>d.id::text)::timestamptz) then raise exception 'MERCHANT_DRAFT_CHANGED'; end if;
  end if;
  if (select count(*) from private.merchant_workspace_drafts where merchant_id=p_merchant_id and id=any(p_ids) and published_at is null and external_url is null and archived_at is null)<>cardinality(p_ids) then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  update private.merchant_workspace_drafts set approved_at=case when p_approve then now() end,approved_by=case when p_approve then auth.uid() end,
    updated_at=now() where merchant_id=p_merchant_id and id=any(p_ids) and published_at is null and external_url is null and archived_at is null;
  get diagnostics changed=row_count;
  if changed<>cardinality(p_ids) then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  return jsonb_build_object('approved',cardinality(p_ids));
end;
$$;
create function public.publish_merchant_workspace_draft(p_merchant_id uuid,p_draft_id uuid,p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare m private.merchants; d private.merchant_workspace_drafts; pid uuid; tag smallint;
begin
  m:=private.assert_merchant_workspace(p_merchant_id);
  select * into d from private.merchant_workspace_drafts where merchant_id=m.id and id=p_draft_id for update;
  if d.id is null or d.channel<>'gling' then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  if d.post_id is not null then return d.post_id; end if;
  if d.published_at is not null or d.archived_at is not null then raise exception 'MERCHANT_DRAFT_PUBLISHED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if m.status='paused' then raise exception 'MERCHANT_OPERATIONS_PAUSED'; end if;
  if m.consent='revoked' then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if d.approved_at is null then raise exception 'MERCHANT_DRAFT_APPROVAL_REQUIRED'; end if;
  if p_expected_updated_at is null or d.updated_at<>p_expected_updated_at then raise exception 'MERCHANT_DRAFT_CHANGED'; end if;
  select id into tag from public.tags where slug=d.tag_slug and kind='post';
  -- Never impersonate the business owner: use the authenticated actor and established safety/quota path.
  pid:=public.create_post(p_city_id=>m.city_id,p_tag_id=>tag,p_title=>d.title,
    p_body=>d.body||E'\n\n'||case when auth.uid()=m.owner_id then '업체에서 직접 게시한 안내입니다.' else '업체의 허락을 받아 글링에서 대신 게시한 안내입니다.' end,p_kind=>d.kind);
  insert into private.merchant_posts(post_id,merchant_id,original_url,creation_request_id) values(pid,m.id,d.original_url,d.id);
  update private.merchant_workspace_drafts set post_id=pid,published_at=now(),updated_at=now() where id=d.id;
  update private.merchants set consent='granted',consent_note=case when consent='pending' then '확인된 업체 소유자가 원고 '||d.id::text||'의 게시를 승인함' else consent_note end,
    updated_at=now() where id=m.id;
  return pid;
end;
$$;
create function public.record_merchant_external_post(p_merchant_id uuid,p_draft_id uuid,p_url text,p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if not private.valid_merchant_original(p_url) or p_url !~ '^https://(cafe\.naver\.com|m\.cafe\.naver\.com|cafe\.daum\.net|m\.cafe\.daum\.net)/' then raise exception 'INVALID_MERCHANT_CAFE_URL'; end if;
  update private.merchant_workspace_drafts set external_url=p_url,updated_at=now()
    where merchant_id=p_merchant_id and id=p_draft_id and channel in ('casmo','hellovancouver') and approved_at is not null and published_at is null and archived_at is null
      and updated_at=p_expected_updated_at;
  if not found then raise exception 'MERCHANT_DRAFT_CHANGED'; end if;
  -- This is the owner's record, not an API-verified publication or measurable café reach.
  return p_draft_id;
end;
$$;

revoke all on function public.approve_merchant_workspace_drafts(uuid,uuid[],boolean,jsonb),
  public.publish_merchant_workspace_draft(uuid,uuid,timestamptz),public.record_merchant_external_post(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.approve_merchant_workspace_drafts(uuid,uuid[],boolean,jsonb),
  public.publish_merchant_workspace_draft(uuid,uuid,timestamptz),public.record_merchant_external_post(uuid,uuid,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
