-- 한 질문씩 만드는 프로필, 공유 카드 미리보기, 접힌 참여 안내.
insert into private.behavior_targets(id) values
('app_meetup-profile.pressable.13'),
('app_meetup-join.pressable.13'),
('components_chilling-host-profile.pressable.3')
on conflict (id) do nothing;
