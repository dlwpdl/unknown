-- 구인구직 filter chips (owner 2026-10-30); unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
  ('listing.filter.jobDeal'), ('listing.filter.jobTypes'), ('listing.filter.wage'), ('listing.filter.area')
on conflict do nothing;
