begin;
set local search_path=public,extensions;
select plan(1);
select is((select count(*) from private.behavior_targets where id = 'post.location.mode'),1::bigint,'the picker map switch is an accepted analytics target');
select * from finish();
rollback;
