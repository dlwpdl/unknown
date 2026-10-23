-- Fixed actions only; shared post IDs and destinations are not telemetry targets.
insert into private.behavior_targets(id) values
 ('shared.web.home'), ('shared.web.open_app'), ('shared.web.ios_store'),
 ('shared.web.copy_link'), ('shared.web.retry'), ('shared.web.same_post'),
 ('shared.auth.retry')
on conflict (id) do nothing;
notify pgrst, 'reload schema';
