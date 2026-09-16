insert into auth.users(id,email) values
  ('4a000000-0000-0000-0000-000000000001','post-edit@example.test'),
  ('4a000000-0000-0000-0000-000000000009','post-admin@example.test');
update auth.users set raw_app_meta_data = jsonb_build_object('role','admin') where id='4a000000-0000-0000-0000-000000000009';
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
  ('4a000000-0000-0000-0000-000000000001','수정테스트','vancouver',now(),now(),now(),'test'),
  ('4a000000-0000-0000-0000-000000000009','관리자','vancouver',now(),now(),now(),'test');

select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'원래 제목','원래 본문','{}','{}');
reset role;
select set_config('test.post_id',(select id::text from public.posts where title='원래 제목'),true);

-- 비로그인 조회는 SECURITY DEFINER 라 view_count 를 올릴 수 있어야 한다 (가드 우회 확인)
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.record_post_view(current_setting('test.post_id')::uuid);
reset role;
do $$ begin
  assert (select view_count from public.posts where id=current_setting('test.post_id')::uuid)=1,'definer RPC must still update counters';
end $$;

select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- 본문 수정은 된다
update public.posts set title='고친 제목', body='고친 본문' where id=current_setting('test.post_id')::uuid;
reset role;
do $$
declare before_sort timestamptz;
begin
  assert (select title from public.posts where id=current_setting('test.post_id')::uuid)='고친 제목','author may edit the title';
  assert (select sort_at = created_at from public.posts where id=current_setting('test.post_id')::uuid),'editing must not bump the feed position';
end $$;

-- 잠긴 컬럼은 막힌다
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- 조회수·정렬·공감수는 컬럼 권한 자체가 없어야 한다
do $$ begin
  begin update public.posts set view_count=99999 where id=current_setting('test.post_id')::uuid;
    raise exception 'view_count must not be writable';
  exception when insufficient_privilege then null; end;
  begin update public.posts set sort_at=now()+interval '1 day' where id=current_setting('test.post_id')::uuid;
    raise exception 'sort_at must not be writable';
  exception when insufficient_privilege then null; end;
  begin update public.posts set like_count=500 where id=current_setting('test.post_id')::uuid;
    raise exception 'like_count must not be writable';
  exception when insufficient_privilege then null; end;
end $$;

-- 작성자 삭제는 된다
update public.posts set status='removed' where id=current_setting('test.post_id')::uuid;
reset role;
do $$ begin
  assert (select status from public.posts where id=current_setting('test.post_id')::uuid)='removed','author may delete';
  assert (select deleted_at is not null from public.posts where id=current_setting('test.post_id')::uuid),'the author deletion is stamped by the trigger';
end $$;

-- 되돌리기는 작성자에게 없다
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin update public.posts set status='published' where id=current_setting('test.post_id')::uuid;
    raise exception 'author restore must be blocked';
  exception when sqlstate 'P0001' then if sqlerrm <> 'POST_RESTORE_NOT_ALLOWED' then raise; end if; end;
end $$;
reset role;

-- 어드민은 대시보드 RPC 로 내리고 되돌린다
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000009","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.set_admin_post_fields(current_setting('test.post_id')::uuid,'{"status":"published"}'::jsonb);
reset role;
do $$ begin
  assert (select status from public.posts where id=current_setting('test.post_id')::uuid)='published','admin may restore';
end $$;

-- 일반 사용자는 어드민 RPC 를 쓸 수 없다
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.set_admin_post_fields(current_setting('test.post_id')::uuid,'{"status":"removed"}'::jsonb);
    raise exception 'non-admin must be refused';
  exception when sqlstate 'P0001' then if sqlerrm <> 'ADMIN_REQUIRED' then raise; end if; end;
end $$;

-- 수정으로 들어온 감시어도 잡힌다
reset role;
insert into private.watch_terms(term,category,severity,active) values ('테스트감시어','fraud','high',true)
  on conflict do nothing;
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
update public.posts set body='이 글에는 테스트감시어 가 들어있다' where id=current_setting('test.post_id')::uuid;
reset role;
do $$ begin
  assert exists (select 1 from public.safety_alerts where target_id=current_setting('test.post_id')::uuid),
    'an edit that introduces a watch term must raise an alert';
end $$;


-- 어드민은 조회수·순위·해시태그를 조정한다
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000009","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.set_admin_post_fields(current_setting('test.post_id')::uuid,
  '{"view_count":1234,"hashtags":["밴쿠버","공지"]}'::jsonb);
reset role;
do $$ begin
  assert (select view_count from public.posts where id=current_setting('test.post_id')::uuid)=1234,'admin may set the view count';
  assert (select hashtags from public.posts where id=current_setting('test.post_id')::uuid)='{밴쿠버,공지}','admin may set hashtags';
end $$;

-- 어드민이 순위를 올리면 피드 정렬 값이 바뀐다
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000009","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.set_admin_post_fields(current_setting('test.post_id')::uuid,
  jsonb_build_object('sort_at', (now()+interval '1 hour')::text));
reset role;
do $$ begin
  assert (select sort_at > now() from public.posts where id=current_setting('test.post_id')::uuid),'admin may pin a post to the top';
end $$;

-- 어드민이 아닌 값은 거부한다
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000009","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
do $$ begin
  begin perform public.set_admin_post_fields(current_setting('test.post_id')::uuid,'{"title":"몰래수정"}'::jsonb);
    raise exception 'unknown fields must be refused';
  exception when sqlstate 'P0001' then if sqlerrm <> 'INVALID_POST_PATCH' then raise; end if; end;
end $$;
reset role;

select 'ALL POST EDIT CHECKS PASSED' as result;
