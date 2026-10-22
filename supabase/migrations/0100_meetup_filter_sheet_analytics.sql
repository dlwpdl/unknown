-- 0100: 모임 탭을 한 줄 필터 + 시트로 접으면서 바뀐 컨트롤. 0073·0082와 같은 고정 식별자만 허용한다.
insert into private.behavior_targets(id) values
('app_tabs_meetups.pressable.13'),
('app_tabs_meetups.pressable.14'),
('app_tabs_meetups.pressable.15'),
('app_tabs_meetups.pressable.16'),
('app_tabs_meetups.switch.1.on'),
('app_tabs_meetups.switch.1.off'),
('components_state-card.pressable.1')
on conflict (id) do nothing;

-- 0100: 모임 프로필에 사진·예시 칩·관심사 태그·미리보기가 생기면서 늘어난 컨트롤.
insert into private.behavior_targets(id) values
('app_meetup-profile.pressable.5'),
('app_meetup-profile.pressable.6'),
('app_meetup-profile.pressable.7'),
('app_meetup-profile.pressable.8'),
('app_meetup-profile.pressable.9')
on conflict (id) do nothing;
