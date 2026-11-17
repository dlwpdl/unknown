-- Post detail 연락하기 button (unclaimed business posts) and the 카톡 id copy row, kept apart from the Gling chat targets.
-- Until this runs, a batch holding either id is rejected as INVALID_BEHAVIOR and dropped by the app.
insert into private.behavior_targets(id) values ('post.detail.contact'), ('post.apply.kakao')
on conflict do nothing;
