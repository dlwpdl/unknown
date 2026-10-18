-- Change future system copy; retain customer text, past notifications and post bodies.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.create_admin_merchant_post(uuid,text,text,text,text,text,uuid)',
    'private.notify_saved_merchant_post(uuid,boolean)',
    'private.notify_merchant_review_received()',
    'private.create_merchant_operation_event(uuid,uuid,text)',
    'private.merchant_review_safety_content(uuid)',
    'private.merchant_review_reply_safety_content(uuid)',
    'private.notify_merchant_review_reply()'
  ] loop
    if to_regprocedure(signature) is not null then
      definition:=pg_get_functiondef(signature::regprocedure);
      execute replace(replace(definition,'업체','비즈니스'),'벤더','비즈니스');
    end if;
  end loop;
end $$;

-- Both generations of disclosure text must produce the same existing quota fingerprint.
create or replace function private.promotion_fingerprint(p_body text) returns text
language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(regexp_replace(lower(replace(replace(replace(replace(p_body,
    '업체에서 직접 게시한 안내입니다.',''),'업체의 허락을 받아 글링에서 대신 게시한 안내입니다.',''),
    '비즈니스에서 직접 게시한 안내입니다.',''),'비즈니스의 허락을 받아 글링에서 대신 게시한 안내입니다.','')),
    '[^[:alnum:]가-힣]+','','g'),'UTF8')),'hex');
$$;
alter function private.promotion_fingerprint(text) owner to postgres;
revoke all on function private.promotion_fingerprint(text) from public,anon,authenticated,service_role;

insert into private.behavior_targets(id) values
  ('profile.nickname.edit'),('profile.nickname.cancel'),('profile.nickname.save')
on conflict do nothing;
notify pgrst,'reload schema';
