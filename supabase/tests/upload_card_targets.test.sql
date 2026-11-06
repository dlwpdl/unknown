begin;
set local search_path=public,extensions;
select plan(1);
-- 20261104090000: the upload card's failure buttons must not reject the analytics batch.
select is((select count(*)::int from private.behavior_targets where id in ('upload.retry','upload.edit')), 2, 'upload card buttons are allowed analytics targets');
select * from finish();
rollback;
