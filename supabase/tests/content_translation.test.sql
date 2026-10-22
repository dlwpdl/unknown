begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
do $$
begin
  assert to_regprocedure('public.claim_content_translation(text,uuid,text,text,uuid,integer)') is not null,
    'Content translation cache is missing';
  assert not has_function_privilege('authenticated','public.claim_content_translation(text,uuid,text,text,uuid,integer)','execute');
  assert not has_function_privilege('anon','public.claim_content_translation(text,uuid,text,text,uuid,integer)','execute');
  assert not has_table_privilege('authenticated','private.content_translations','select');
  assert not has_table_privilege('anon','private.content_translations','select');
end $$;

insert into auth.users(id,email,raw_app_meta_data) values
 ('9f510000-0000-4000-8000-000000000001','translation-owner@example.test','{}'),
 ('9f510000-0000-4000-8000-000000000002','translation-reader@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('9f510000-0000-4000-8000-000000000001','번역검사작성자','vancouver'),
 ('9f510000-0000-4000-8000-000000000002','번역검사독자','vancouver');
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('9f510000-0000-4000-8000-000000000010','9f510000-0000-4000-8000-000000000001','vancouver',1,'산책','같이 가요.');
insert into public.comments(id,post_id,author_id,body,parent_id,reply_to_id) values
 ('9f510000-0000-4000-8000-000000000020','9f510000-0000-4000-8000-000000000010','9f510000-0000-4000-8000-000000000001','원 댓글',null,null),
 ('9f510000-0000-4000-8000-000000000021','9f510000-0000-4000-8000-000000000010','9f510000-0000-4000-8000-000000000001','답글','9f510000-0000-4000-8000-000000000020','9f510000-0000-4000-8000-000000000020');

do $$
declare
  first jsonb;
  next jsonb;
  viewer uuid := '9f510000-0000-4000-8000-000000000002';
  post_id uuid := '9f510000-0000-4000-8000-000000000010';
begin
  first := public.claim_content_translation('post',post_id,'en',repeat('a',64),viewer,10);
  assert first->>'state'='claimed';
  next := public.claim_content_translation('post',post_id,'en',repeat('a',64),viewer,10);
  assert next->>'state'='pending', 'simultaneous readers must not generate twice';
  assert (select requests=1 from private.content_translation_usage where bucket=viewer::text and usage_day=(now() at time zone 'UTC')::date);
  assert not public.finish_content_translation('post',post_id,'en',repeat('a',64),gen_random_uuid(),'{"title":"Walk","body":"Come along."}');
  assert public.finish_content_translation('post',post_id,'en',repeat('a',64),(first->>'token')::uuid,'{"title":"Walk","body":"Come along."}');
  update private.content_translation_usage set requests=200 where bucket=viewer::text;
  next := public.claim_content_translation('post',post_id,'en',repeat('a',64),viewer,10);
  assert next->>'state'='cached', 'shared cached results do not spend the reader budget';
  assert next->'translation'->>'body'='Come along.';
  assert public.claim_content_translation('post',post_id,'ko',repeat('b',64),viewer,10)->>'state'='limited';
  update private.content_translation_usage set requests=0 where bucket=viewer::text;
  update private.content_translation_usage set characters=100000 where bucket='project';
  assert public.claim_content_translation('post',post_id,'ko',repeat('b',64),viewer,10)->>'state'='limited';
  update private.content_translation_usage set characters=0 where bucket='project';
  first := public.claim_content_translation('post',post_id,'ko',repeat('b',64),viewer,10);
  assert first->>'state'='claimed', 'languages have separate cache entries';
  perform public.fail_content_translation('post',post_id,'ko',repeat('b',64),(first->>'token')::uuid);
  assert public.claim_content_translation('post',post_id,'ko',repeat('b',64),viewer,10)->>'state'='pending';
  update public.posts set body='수정한 글' where id=post_id;
  assert not exists(select from private.content_translations where content_id=post_id), 'editing purges both language versions';
  assert not public.finish_content_translation('post',post_id,'ko',repeat('b',64),(first->>'token')::uuid,'{"title":"Old","body":"Old"}');
end $$;

select set_config('request.jwt.claims','{"sub":"9f510000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
  assert (select count(*)=1 from public.posts where id='9f510000-0000-4000-8000-000000000010');
  assert (select count(*)=1 from public.comments where id='9f510000-0000-4000-8000-000000000021');
end $$;
reset role;
insert into public.blocks(blocker_id,blocked_id) values ('9f510000-0000-4000-8000-000000000002','9f510000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
begin
  assert (select count(*)=0 from public.posts where id='9f510000-0000-4000-8000-000000000010'), 'source reads retain block RLS';
  assert (select count(*)=0 from public.comments where id='9f510000-0000-4000-8000-000000000021');
end $$;
reset role;
delete from public.blocks where blocker_id='9f510000-0000-4000-8000-000000000002';
select public.claim_content_translation('comment','9f510000-0000-4000-8000-000000000021','en',repeat('c',64),'9f510000-0000-4000-8000-000000000002',2);
update public.comments set deleted_at=now() where id='9f510000-0000-4000-8000-000000000020';
set local role authenticated;
do $$ begin
  assert (select count(*)=0 from public.comments where id='9f510000-0000-4000-8000-000000000021'), 'hidden ancestors also hide reply sources';
end $$;
reset role;
do $$ begin
  assert not exists(select from private.content_translations where content_id='9f510000-0000-4000-8000-000000000021'), 'hiding a parent purges reply cache';
  raise notice 'content translation: cache, leases, quota, RLS and invalidation passed';
end $$;
rollback;
