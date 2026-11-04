begin;
set local search_path=public,extensions;
select plan(1);
select is((select count(*) from private.behavior_targets where id in ('share.card.scroll','share.card.tone','share.card.sender.on','share.card.sender.off','share.card.export','places.detail.share','saved.folder.share')),7::bigint,'every share card control is an accepted analytics target');
select * from finish();
rollback;
