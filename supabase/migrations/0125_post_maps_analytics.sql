-- Fixed control identifier only; map URLs and place names are never telemetry targets.
insert into private.behavior_targets(id) values
('components_post-map-link.pressable.1')
on conflict (id) do nothing;
