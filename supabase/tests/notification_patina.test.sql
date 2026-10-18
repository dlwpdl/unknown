begin;
set local search_path=public,extensions;
select no_plan();

create temp table patina_event as select '{"name":"Halloween Session","segment":"Miscellaneous","venue":"Village Studios","startsAt":"2026-10-25T02:00:00Z"}'::jsonb event;
select is(private.event_recommendation_body(null,event,'vancouver'),
 '10월 24일, Village Studios에서 할로윈 행사가 열려요.',
 'event copy starts with real facts instead of repeating an event introduction') from patina_event;

create temp table patina_variants as select body from (values
 ('10월 24일, Village Studios에서 할로윈 행사가 열려요.'),
 ('Village Studios에서 10월 24일에 할로윈 행사가 열려요.'),
 ('10월 24일, Village Studios에서 할로윈 행사가 열릴 예정이에요.'),
 ('Village Studios에서 10월 24일에 할로윈 행사가 열릴 예정이에요.')
) v(body);
select is(private.event_recommendation_body(null,event,'vancouver',body),body,
 'a retry preserves each of the four complete sentence styles') from patina_event cross join patina_variants;
select is(private.event_recommendation_body(null,event,'vancouver','행사 소식이에요. 할로윈 행사예요. 10월 24일, Village Studios에서 열려요.'),
 '10월 24일, Village Studios에서 할로윈 행사가 열려요.',
 'legacy queued copy loses its redundant introduction at delivery') from patina_event;
select is(private.event_recommendation_body(null,event||'{"description":"야외 무대에서 밴드 공연과 공개 잼 세션이 열려요."}','vancouver',body),
 '야외 무대에서 밴드 공연과 공개 잼 세션이 열려요.',
 'a useful source sentence is kept intact without an extra introduction') from patina_event cross join patina_variants;
select is(private.event_recommendation_body(null,event||'{"description":"<p>10월 24일, Village Studios에서 할로윈 행사가 열려요.</p>"}','vancouver',body),
 '10월 24일, Village Studios에서 할로윈 행사가 열려요.',
 'authored source copy remains intact even when it resembles a generated template') from patina_event cross join patina_variants;
select ok(private.festival_notification_body('{"segment":"Music","genre":"Jazz","venue":"Fixture Hall","startsAt":"2026-10-25T02:00:00Z"}','vancouver')
 = '10월 24일, Fixture Hall에서 재즈 공연이 열려요.', 'concerts use the correct Korean subject particle');
select ok(private.festival_notification_body('{"segment":"Sports","genre":"Basketball","venue":"Fixture Hall","startsAt":"2026-10-25T02:00:00Z"}','vancouver')
 = '10월 24일, Fixture Hall에서 농구 경기가 열려요.', 'sports keep the verified category and correct particle');
select ok(private.festival_notification_body('{}','vancouver')='밴쿠버에서 행사가 열려요.',
 'missing details use the known city without inventing a date or genre');
select ok(not exists(select 1 from patina_event cross join patina_variants
 where char_length(private.event_recommendation_body(null,event,'vancouver',body))>90), 'all variants fit the existing notification budget');
select ok(not has_function_privilege('anon','private.event_recommendation_body(uuid,jsonb,text,text)','execute')
 and not has_function_privilege('authenticated','private.festival_notification_body(jsonb,text)','execute')
 and not has_function_privilege('service_role','private.event_recommendation_body(uuid,jsonb,text,text)','execute'),
 'copy formatting remains private');
select * from finish();
rollback;
