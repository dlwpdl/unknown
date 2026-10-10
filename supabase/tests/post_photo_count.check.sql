begin;
insert into auth.users(id,email) values ('13400000-0000-0000-0000-000000000001','photo-count@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
values ('13400000-0000-0000-0000-000000000001','사진한도검사','vancouver',now(),now(),now(),'test');
select set_config('request.jwt.claims','{"sub":"13400000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
declare paths text[]; post_id uuid;
begin
  select array_agg('13400000-0000-0000-0000-000000000001/'||n||'.webp' order by n) into paths from generate_series(1,10) n;
  foreach post_id in array array[
    public.create_post('vancouver',(select id from public.tags where slug='life'),'열 사진 일반 글','수량 검증',p_image_paths=>paths),
    public.create_post('vancouver',(select id from public.tags where slug='life'),'열 사진 중고 글','수량 검증',p_image_paths=>paths,p_kind=>'listing')
  ] loop
    assert (select image_paths=paths from public.posts where id=post_id), 'ten photos must retain order';
    update public.posts set image_paths=paths where id=post_id;
    begin
      update public.posts set image_paths=paths||array['13400000-0000-0000-0000-000000000001/11.webp'] where id=post_id;
      raise exception 'eleven photos passed the table constraint';
    exception when check_violation then null; end;
  end loop;
  begin
    perform public.create_post('vancouver',(select id from public.tags where slug='life'),'초과 수량','검사',p_image_paths=>paths||array['13400000-0000-0000-0000-000000000001/11.webp']);
    raise exception 'eleven photos passed create_post';
  exception when sqlstate 'P0001' then assert sqlerrm='TOO_MANY_IMAGES', sqlerrm; end;
  begin
    perform public.create_post('vancouver',(select id from public.tags where slug='life'),'다른 작성자 사진','검사',p_image_paths=>array['other/private.webp']);
    raise exception 'foreign photo passed create_post';
  exception when sqlstate 'P0001' then assert sqlerrm='INVALID_IMAGE_PATH', sqlerrm; end;
end;
$$;
reset role;
do $$
declare paths text[];
begin
  select array_agg('13400000-0000-0000-0000-000000000001/'||n||'.webp' order by n) into paths from generate_series(1,10) n;
  perform private.assert_merchant_image_paths(paths,paths);
  begin
    perform private.assert_merchant_image_paths(paths||paths[1],paths);
    raise exception 'eleven merchant photos passed';
  exception when sqlstate 'P0001' then assert sqlerrm='INVALID_IMAGE_PATH', sqlerrm; end;
  begin
    perform private.assert_merchant_image_paths(array[paths[1],paths[1]],paths);
    raise exception 'duplicate merchant photos passed';
  exception when sqlstate 'P0001' then assert sqlerrm='INVALID_IMAGE_PATH', sqlerrm; end;
  assert not has_function_privilege('anon','public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)','execute');
  assert not has_function_privilege('authenticated','private.assert_merchant_image_paths(text[],text[])','execute');
end;
$$;
select 'PASS: ten-photo create/edit/listing/merchant order; eleven-photo/foreign/duplicate rejection; privileges intact' as result;
rollback;
