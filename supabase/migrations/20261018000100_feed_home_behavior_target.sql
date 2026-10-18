-- Preserve the logo-to-Today control without rejecting its analytics batch.
insert into private.behavior_targets(id) values ('feed.home')
on conflict (id) do nothing;
