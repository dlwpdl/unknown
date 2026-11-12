begin;
set local search_path=public,extensions;
select plan(1);
select is((select count(*) from private.behavior_targets where id in ('discovery.compose','places.detail.compose')),2::bigint,'both 이 장소로 글쓰기 buttons are accepted analytics targets');
select * from finish();
rollback;
