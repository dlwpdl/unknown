-- 부동산 렌트·매매 filter chip; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values ('listing.filter.market') on conflict do nothing;
