-- Fixed targets only; the selected price band and event identity are not recorded.
insert into private.behavior_targets(id) values
  ('ticketmaster.price.filters'), ('ticketmaster.price.select')
on conflict (id) do nothing;
