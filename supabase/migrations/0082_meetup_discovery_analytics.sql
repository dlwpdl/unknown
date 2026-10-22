-- 모임 탭 검색·필터와 모임 자리 안내에 추가한 컨트롤. 0073과 같은 고정 식별자만 허용한다.
insert into private.behavior_targets(id) values
('app_tabs_meetups.pressable.7'),
('app_tabs_meetups.pressable.8'),
('app_tabs_meetups.pressable.9'),
('app_tabs_meetups.pressable.10'),
('app_tabs_meetups.pressable.11'),
('app_tabs_meetups.scrollview.2'),
('app_tabs_meetups.pressable.12'),
('app_meetup-create.pressable.5'),
('app_meetup-join.pressable.10')
on conflict (id) do nothing;
