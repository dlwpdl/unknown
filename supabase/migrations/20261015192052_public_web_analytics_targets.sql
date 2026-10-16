-- Fixed public reader actions; arbitrary targets remain rejected.
insert into private.behavior_targets(id) values ('web_control_21'), ('web_control_22')
on conflict (id) do nothing;
