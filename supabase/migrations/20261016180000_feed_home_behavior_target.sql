insert into private.behavior_targets(id) values ('feed.home')
on conflict (id) do nothing;
