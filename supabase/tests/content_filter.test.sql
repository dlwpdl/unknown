begin;

select plan(8);

select has_function('private', 'assert_content_allowed', array['text'], 'server content filter exists');
select lives_ok(
  $$select private.assert_content_allowed('캐나다 정책에 동의하지 않지만 근거를 듣고 이야기하고 싶습니다.')$$,
  'political disagreement is allowed'
);
select throws_ok(
  $$select private.assert_content_allowed('너는 진짜 개새끼야')$$,
  'P0001',
  'CONTENT_NOT_ALLOWED',
  'direct Korean profanity is rejected'
);
select throws_ok(
  $$select private.assert_content_allowed('칼로 찔러 죽여버리겠다')$$,
  'P0001',
  'CONTENT_NOT_ALLOWED',
  'credible violent wording is rejected'
);
select throws_ok(
  $$select private.assert_content_allowed('you are a fucking bitch')$$,
  'P0001',
  'CONTENT_NOT_ALLOWED',
  'direct English profanity is rejected'
);
select has_trigger('public', 'posts', 'posts_content_filter', 'posts are filtered at the database boundary');
select has_trigger('public', 'comments', 'comments_content_filter', 'comments are filtered at the database boundary');
select has_trigger('public', 'messages', 'messages_content_filter', 'private messages are filtered at the database boundary');

select * from finish();
rollback;
