-- 모임 프로필·신청 상태·호스트 검토에서 사용하는 고정 컨트롤 식별자.
insert into private.behavior_targets(id) values
('app_meetup-profile.pressable.10'),
('app_meetup-profile.pressable.11'),
('app_meetup-profile.pressable.12'),
('app_meetup-join.pressable.11'),
('app_meetup-join.pressable.12'),
('app_meetup-application.pressable.3'),
('app_meetup-application.pressable.4'),
('components_chilling-host-profile.pressable.2')
on conflict (id) do nothing;
