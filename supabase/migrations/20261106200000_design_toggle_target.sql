-- 설정의 3D 디자인 스위치 (owner 2026-11-06 "2디/3디만 왓다갓다 할수잇게"). Additive analytics target only: an unknown target would reject the member's whole analytics batch.
insert into private.behavior_targets(id) values
  ('app_profile_settings.switch.design.off'),
  ('app_profile_settings.switch.design.on')
on conflict do nothing;
